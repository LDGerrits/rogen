import { Sequencer } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { Diagnostic, isError } from "../../platform/diagnostics/diagnostic.js";
import { FileChange, FileChangeType } from "../../platform/fs/file-changes.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { Watcher, WatchRequest } from "../../platform/watcher/watcher.js";
import { BuildService } from "../build/build-service.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigEntry, ConfigService } from "../config/config-service.js";
import { ChangeBatcher } from "./change-batcher.js";
import { WatchPlan } from "./watch-plan.js";
import {
	ConfigNotice,
	RebuildReport,
	WatchCause,
	WatchSession,
	WatchUpdate,
} from "./watch-service.js";

/** A running watch: reloads a changed config, re-plans what it watches, and rebuilds each affected config; rebuilds of one config never overlap. */
export class CoreWatchSession
	extends AbstractDisposable
	implements WatchSession
{
	private readonly _onDidUpdate = this._register(new Emitter<WatchUpdate>());
	readonly onDidUpdate: Event<WatchUpdate> = this._onDidUpdate.event;

	/** A step failed unexpectedly; the watch goes on. */
	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	private readonly batcher: ChangeBatcher;
	private readonly intake = new Sequencer();
	private readonly updates = new Sequencer();
	private readonly rebuilds = new Map<string, Sequencer>();
	private readonly pending = new Set<Promise<void>>();
	private readonly changedConfigs = new Set<string>();
	/** The files each config's latest build read, beyond the config files themselves. */
	private readonly readFiles = new Map<string, ReadonlySet<string>>();
	private readonly failing = new Set<string>();
	/** The configs that can't be built beside the others, by config file, from the latest load. */
	private blocked: ReadonlyMap<string, readonly Diagnostic[]> = new Map();
	private rebuilding = 0;
	private settled = false;
	private notices: ConfigNotice[] = [];
	private plan: WatchPlan;
	private activeWatch = "";
	private stopping: Promise<void> | undefined;

	constructor(
		private readonly watcher: Watcher,
		private readonly logService: LogService,
		private readonly configService: ConfigService,
		private readonly indexService: IndexService,
		private readonly buildService: BuildService
	) {
		super();
		this.batcher = this._register(new ChangeBatcher(logService));
		this.plan = new WatchPlan(this.currentConfigs);
	}

	private get currentConfigs(): ResolvedConfig[] {
		return this.configService
			.getResolvedEntries()
			.map(({ config }) => config);
	}

	/** Resolves once the watcher is live and the initial build is queued, so no change goes unseen. */
	async start(): Promise<void> {
		this._register(
			this.configService.onDidChangeConfig((event) =>
				this.changedConfigs.add(event.resource)
			)
		);
		this._register(
			this.watcher.onDidChangeFile((changes) => {
				const relevant = this.dropSourceUpdates(changes);
				if (relevant.length > 0) {
					this.batcher.queueEvents(relevant);
				}
			})
		);
		this._register(
			this.batcher.onDidEmitChanges((changes) =>
				this.enqueue(() => this.onChanges(changes))
			)
		);
		this._register(
			this.batcher.onDidOverflow(() => this.enqueue(() => this.onBurst()))
		);

		this.configService.configs.forEach((entry) => this.noteConfig(entry));
		this.refreshBlocked();
		await this.watchPlan();
		this.announce(
			{ kind: "initial" },
			this.currentConfigs.map(({ file }) => this.queueRebuild(file, true))
		);
		this.settled = true;
	}

	/** Lets the work already started finish, drops anything queued after, and stops the watcher. Safe to call twice. */
	stop(): Promise<void> {
		this.stopping ??= (async () => {
			await Promise.allSettled([...this.pending]);
			await this.watcher.stop();
		})();
		return this.stopping;
	}

	/** Stops the session if `stop` wasn't awaited, then drops its subscriptions. */
	override [Symbol.dispose](): void {
		this.stop().catch(onUnexpectedError);
		super[Symbol.dispose]();
	}

	/** An update to a file no build read changes nothing; while what a build read is unknown, every update counts. */
	private dropSourceUpdates(changes: readonly FileChange[]): FileChange[] {
		if (!this.settled || this.rebuilding > 0 || this.failing.size > 0) {
			return [...changes];
		}
		const contentFiles = this.configService.files;
		return changes.filter(
			(change) =>
				change.type !== FileChangeType.UPDATED ||
				contentFiles.has(change.path) ||
				[...this.readFiles.values()].some((files) =>
					files.has(change.path)
				)
		);
	}

	private noteConfig(entry: ConfigEntry): void {
		this.notices.push({
			file: entry.file,
			errors: entry.errors,
			warnings: entry.diagnostics.filter(
				(diagnostic) => !isError(diagnostic)
			),
		});
	}

	/** `load` also checks the sync dir, which only changes when the config or its compiler does. */
	private async rebuild(
		file: string,
		load: boolean
	): Promise<RebuildReport | undefined> {
		const entry = this.configService.getConfig(file);
		const config = entry?.resolved;
		if (!entry || !config) return undefined;
		const blocked = this.blocked.get(file);
		if (blocked) {
			this.failing.add(file);
			return {
				entry,
				config,
				outcome: "failed",
				warnings: [],
				syncWarnings: [],
				errors: blocked,
				checkedSyncDir: false,
			};
		}

		const [build] = await this.buildService.run([config], {
			checkSyncDir: load,
		});
		if (build.outcome === "failed") this.failing.add(file);
		else {
			this.failing.delete(file);
			this.readFiles.set(file, new Set(build.readFiles));
		}
		return { ...build, entry, checkedSyncDir: load };
	}

	/** Runs `task`, turning a throw into `onDidError`; queued work is dropped once the session stops. */
	private guarded<T>(task: () => Promise<T>): () => Promise<T | undefined> {
		return async () => {
			if (this.stopping) return undefined;
			try {
				return await task();
			} catch (error) {
				this._onDidError.fire(ErrorUtils.fromUnknown(error));
				return undefined;
			}
		};
	}

	private track(queued: Promise<unknown>): void {
		const tracked = queued.then(
			() => undefined,
			() => undefined
		);
		this.pending.add(tracked);
		void tracked.finally(() => this.pending.delete(tracked));
	}

	private queueRebuild(
		file: string,
		load: boolean
	): Promise<RebuildReport | undefined> {
		let sequencer = this.rebuilds.get(file);
		if (!sequencer) {
			sequencer = new Sequencer();
			this.rebuilds.set(file, sequencer);
		}
		this.rebuilding++;
		const queued = sequencer.queue(
			this.guarded(() => this.rebuild(file, load))
		);
		void queued.then(
			() => this.rebuilding--,
			() => this.rebuilding--
		);
		this.track(queued);
		return queued;
	}

	private enqueue(task: () => Promise<void>): void {
		this.track(this.intake.queue(this.guarded(task)));
	}

	/** Fires once `results` settle, after every earlier update; nothing fires for a round with nothing to say. */
	private announce(
		cause: WatchCause,
		results: readonly Promise<RebuildReport | undefined>[],
		changes: readonly FileChange[] = []
	): void {
		const at = new Date();
		const notices = this.notices.splice(0);
		if (notices.length === 0 && results.length === 0) return;
		this.track(
			this.updates.queue(async () => {
				try {
					const reports = (await Promise.all(results)).filter(
						(report) => report !== undefined
					);
					if (notices.length === 0 && reports.length === 0) return;
					this._onDidUpdate.fire({
						at,
						cause,
						changes,
						notices,
						reports,
					});
				} catch (error) {
					this._onDidError.fire(ErrorUtils.fromUnknown(error));
				}
			})
		);
	}

	private watchRequests(): WatchRequest[] {
		return [
			...[...this.configService.files].map((file) => ({
				path: file,
				recursive: false,
			})),
			...this.plan.roots.map((dir) => ({ path: dir, recursive: true })),
		];
	}

	// JSON.stringify drops a RegExp's source, so patterns are stringified explicitly.
	private watchKey(): string {
		return JSON.stringify([
			this.watchRequests(),
			this.plan.ignored.map(String),
		]);
	}

	private async watchPlan(): Promise<void> {
		this.activeWatch = this.watchKey();
		await this.watcher.watch(this.watchRequests(), {
			ignored: [...this.plan.ignored],
		});
		await this.indexService.initialize(this.plan.roots);
	}

	/** Whether the plan changed enough to restart the watcher and reindex. */
	private async refreshPlan(): Promise<boolean> {
		this.plan = new WatchPlan(this.currentConfigs);
		if (this.watchKey() === this.activeWatch) return false;
		await this.watchPlan();
		return true;
	}

	/** Re-checks the configs as a set, and returns the config files whose block was lifted or put on. */
	private refreshBlocked(): string[] {
		const before = this.blocked;
		this.blocked = this.buildService.blockedConfigs(this.currentConfigs);
		return [...new Set([...before.keys(), ...this.blocked.keys()])].filter(
			(file) => before.has(file) !== this.blocked.has(file)
		);
	}

	private async reloadConfigs(files: readonly string[]): Promise<string[]> {
		await this.configService.reload(files);
		this.configService.configs.forEach((entry) => this.noteConfig(entry));
		const changed = [...this.changedConfigs];
		this.changedConfigs.clear();
		return changed;
	}

	/** Reloads until the watch plan settles, since a reload can change what's watched. */
	private async applyConfigChanges(files: readonly string[]): Promise<{
		reloaded: string[];
		reindexed: boolean;
		reblocked: string[];
	}> {
		const reloaded = new Set<string>();
		let reindexed = false;
		let toReload = files;
		for (;;) {
			for (const file of await this.reloadConfigs(toReload)) {
				reloaded.add(file);
			}
			if (!(await this.refreshPlan())) break;
			reindexed = true;
			// A config edited while the watcher restarted was never reported.
			toReload = [...this.configService.files];
		}
		return {
			reloaded: [...reloaded],
			reindexed,
			reblocked: this.refreshBlocked(),
		};
	}

	private async onChanges(changes: FileChange[]): Promise<void> {
		const configFiles = changes
			.map((change) => change.path)
			.filter((file) => this.configService.files.has(file));

		let reloaded: string[] = [];
		let reindexed = false;
		let reblocked: string[] = [];
		if (configFiles.length > 0) {
			({ reloaded, reindexed, reblocked } =
				await this.applyConfigChanges(configFiles));
		}

		const sourceChanges = changes.filter((change) =>
			this.plan.watches(change.path)
		);
		if (sourceChanges.length > 0) {
			await this.indexService.applyChanges(sourceChanges);
		}

		const affected = new Set([
			...reloaded,
			...reblocked,
			...(reindexed ? this.currentConfigs.map(({ file }) => file) : []),
			...sourceChanges.flatMap((change) =>
				this.plan.configsFor(change.path)
			),
		]);
		this.announce(
			{
				kind: "change",
				sourceFiles: sourceChanges.length,
				configFiles,
				reloaded: reloaded.length > 0,
			},
			[...affected].map((file) =>
				this.queueRebuild(
					file,
					reloaded.includes(file) || reblocked.includes(file)
				)
			),
			sourceChanges
		);
	}

	private async onBurst(): Promise<void> {
		const { reloaded, reindexed } = await this.applyConfigChanges([
			...this.configService.files,
		]);
		if (!reindexed) await this.indexService.initialize(this.plan.roots);
		this.announce(
			{ kind: "burst" },
			this.currentConfigs.map(({ file }) =>
				this.queueRebuild(file, reloaded.includes(file))
			)
		);
	}
}
