import { Sequencer } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { FileChange, FileChangeType } from "../../platform/fs/file-changes.js";
import { IndexService, Listing } from "../../platform/fs/index-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { BuildSet } from "../build/build.js";
import { BuildService } from "../build/build-service.js";
import { ResolvedConfig } from "../config/config.js";
import {
	ConfigNotice,
	ConfigSelection,
	buildableConfig,
} from "../config/config-service.js";
import { ChangeBatcher, ChangeBurst } from "./change-batcher.js";
import { WatchedConfig } from "./watched-config.js";
import { WatchPlan } from "./watch-plan.js";
import {
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
	private readonly watched = new Map<string, WatchedConfig>();
	private readonly pending = new Set<Promise<void>>();
	private started = false;
	private notices: ConfigNotice[] = [];
	private plan: WatchPlan;
	/** What the root dirs held after the latest change; only the intake replaces it, and a rebuild reads the one it started with. */
	private listing = Listing.EMPTY;
	private activeWatch = "";
	private stopping: Promise<void> | undefined;

	constructor(
		private readonly selection: ConfigSelection,
		/** The configs that build, from the latest load, and which of them can't. */
		private set: BuildSet,
		private readonly watcher: Watcher,
		private readonly indexService: IndexService,
		private readonly buildService: BuildService
	) {
		super();
		this.batcher = this._register(new ChangeBatcher());
		this.plan = new WatchPlan(this.currentConfigs);
	}

	private get currentConfigs(): ResolvedConfig[] {
		return this.selection.entries.flatMap(
			(entry) => buildableConfig(entry) ?? []
		);
	}

	/** Resolves once the watcher is live and the initial build is queued, so no change goes unseen. */
	async start(): Promise<void> {
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
			this.batcher.onDidOverflow((burst) =>
				this.enqueue(() => this.onBurst(burst))
			)
		);

		await this.watchPlan();
		this.announce(
			{ kind: "initial" },
			this.currentConfigs.map(({ file }) => this.queueRebuild(file))
		);
		this.started = true;
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
		const watched = [...this.watched.values()];
		if (!this.started || watched.some((config) => !config.settled)) {
			return changes.filter((change) => this.isWatched(change.path));
		}
		return changes.filter(
			(change) =>
				this.isWatched(change.path) &&
				(change.type !== FileChangeType.UPDATED ||
					this.selection.reads(change.path) ||
					watched.some((config) => config.reads(change.path)))
		);
	}

	/** Whether the session acts on `file`; the folder watched for configs reports its other entries too. */
	private isWatched(file: string): boolean {
		return (
			!this.selection.directory ||
			this.selection.concerns(file) ||
			this.selection.reads(file) ||
			this.plan.watches(file)
		);
	}

	private async rebuild(
		watched: WatchedConfig,
		file: string
	): Promise<RebuildReport | undefined> {
		if (!this.set.configOf(file)) return undefined;
		return watched.finished(
			await this.buildService.rebuild(
				this.set,
				file,
				this.listing,
				watched.latest
			)
		);
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

	private queueRebuild(file: string): Promise<RebuildReport | undefined> {
		let watched = this.watched.get(file);
		if (!watched) {
			watched = new WatchedConfig();
			this.watched.set(file, watched);
		}
		const config = watched;
		const queued = config.queue(
			this.guarded(() => this.rebuild(config, file))
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

	/** The folder watched for configs added to it and deleted from it. */
	private get shallowDirs(): string[] {
		return this.selection.directory ? [this.selection.directory] : [];
	}

	private watchPaths(): string[] {
		return [...this.selection.files, ...this.plan.roots];
	}

	// JSON.stringify drops a RegExp's source, so patterns are stringified explicitly.
	private watchKey(): string {
		return JSON.stringify([
			this.watchPaths(),
			this.shallowDirs,
			this.plan.ignored.map(String),
		]);
	}

	private async watchPlan(): Promise<void> {
		const key = this.watchKey();
		await this.watcher.watch(this.watchPaths(), {
			ignored: [...this.plan.ignored],
			shallow: this.shallowDirs,
		});
		this.activeWatch = key;
		this.listing = await this.indexService.list(this.plan.roots);
	}

	/** Whether the plan changed enough to restart the watcher and reindex. */
	private async refreshPlan(): Promise<boolean> {
		this.plan = new WatchPlan(this.currentConfigs);
		if (this.watchKey() === this.activeWatch) return false;
		await this.watchPlan();
		return true;
	}

	/** Re-checks the configs as a set, and returns the config files whose block was lifted or put on. */
	private refreshSet(): string[] {
		const before = this.set.blockedFiles;
		this.set = new BuildSet(this.currentConfigs);
		const after = this.set.blockedFiles;
		return [...new Set([...before, ...after])].filter(
			(file) => before.has(file) !== after.has(file)
		);
	}

	/** Drops what the session knows of configs that left the selection. */
	private forgetRemoved(): void {
		const current = new Set(this.currentConfigs.map(({ file }) => file));
		for (const file of this.watched.keys())
			if (!current.has(file)) this.watched.delete(file);
	}

	private async reloadConfigs(
		files: readonly string[]
	): Promise<readonly string[]> {
		const { changed, notices } = await this.selection.reload(files);
		this.notices.push(...notices);
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
			toReload = [...this.selection.files];
		}
		const reblocked = this.refreshSet();
		this.forgetRemoved();
		return { reloaded: [...reloaded], reindexed, reblocked };
	}

	private async onChanges(changes: FileChange[]): Promise<void> {
		const configFiles = changes
			.map((change) => change.path)
			.filter((file) => this.selection.concerns(file));

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
			this.listing = await this.indexService.update(
				this.listing,
				sourceChanges
			);
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
			[...affected].map((file) => this.queueRebuild(file)),
			sourceChanges
		);
	}

	private async onBurst(burst: ChangeBurst): Promise<void> {
		const { reindexed } = await this.applyConfigChanges([
			...this.selection.files,
		]);
		if (!reindexed)
			this.listing = await this.indexService.list(this.plan.roots);
		this.announce(
			{ kind: "burst", ...burst },
			this.currentConfigs.map(({ file }) => this.queueRebuild(file))
		);
	}
}
