import { Sequencer } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../platform/diagnostics/diagnostic.js";
import { FileChange } from "../../platform/fs/file-events.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { ReconciliationService } from "../../platform/watcher/reconciliation-service.js";
import { Watcher, WatchRequest } from "../../platform/watcher/watcher.js";
import { BuildService, BuildSummary } from "../build/build-service.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigEntry, ConfigService } from "../config/config-service.js";
import { resolvedConfigs } from "../config/valid-configs.js";
import { OutputService } from "../output/output-service.js";
import { dropSourceUpdates } from "./drop-source-updates.js";
import { PrintedDiagnostics } from "./printed-diagnostics.js";
import { WatchPlan, createWatchPlan } from "./watch-plan.js";

/** Why the configs were rebuilt. */
export type WatchCause =
	| { readonly kind: "initial" }
	/** Too many changes at once to follow, so everything was rebuilt. */
	| { readonly kind: "burst" }
	| {
			readonly kind: "change";
			readonly sourceFiles: number;
			/** The config files that changed, as absolute paths. */
			readonly configFiles: readonly string[];
			readonly reloaded: boolean;
	  };

/** New problems in a config's latest load; with errors, the last valid version is still what builds. */
export interface ConfigNotice {
	readonly file: string;
	readonly errors: readonly Diagnostic[];
	readonly warnings: readonly Diagnostic[];
}

export interface RebuildReport {
	readonly entry: ConfigEntry;
	/** The version of the config that was built. */
	readonly config: ResolvedConfig;
	readonly outcome: "wrote" | "unchanged" | "failed";
	/** Only what wasn't reported for this config the last time. */
	readonly diagnostics: readonly Diagnostic[];
	/** Set when the build succeeded. */
	readonly summary?: BuildSummary;
}

/** One round of rebuilds, fired once every rebuild in it has finished. */
export interface WatchUpdate {
	readonly at: Date;
	readonly cause: WatchCause;
	/** The source changes behind it. */
	readonly changes: readonly FileChange[];
	readonly notices: readonly ConfigNotice[];
	readonly reports: readonly RebuildReport[];
}

type Stream = "config" | "build" | "sync";

/**
 * A running watch: it watches every config's root dirs and files, reloads a
 * config that changes, re-plans what it watches until that settles, and
 * rebuilds each affected config incrementally. Rebuilds of one config never
 * overlap, and updates fire in the order their changes arrived.
 */
export class WatchSession extends AbstractDisposable {
	private readonly _onDidUpdate = this._register(new Emitter<WatchUpdate>());
	readonly onDidUpdate: Event<WatchUpdate> = this._onDidUpdate.event;

	/** A step failed unexpectedly; the watch goes on. */
	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	private readonly intake = new Sequencer();
	private readonly updates = new Sequencer();
	private readonly rebuilds = new Map<string, Sequencer>();
	private readonly pending = new Set<Promise<void>>();
	private readonly printed = new PrintedDiagnostics();
	private readonly changedConfigs = new Set<string>();
	private notices: ConfigNotice[] = [];
	private plan: WatchPlan;
	private activeWatch = "";
	private stopping: Promise<void> | undefined;

	constructor(
		private readonly watcher: Watcher,
		private readonly reconciliationService: ReconciliationService,
		private readonly configService: ConfigService,
		private readonly indexService: IndexService,
		private readonly buildService: BuildService,
		private readonly outputService: OutputService
	) {
		super();
		this.plan = createWatchPlan(resolvedConfigs(this.configService));
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
				const relevant = dropSourceUpdates(
					changes,
					this.configService.files
				);
				if (relevant.length > 0) {
					this.reconciliationService.queueEvents(relevant);
				}
			})
		);
		this._register(
			this.reconciliationService.onDidEmitChanges((changes) =>
				this.enqueue(() => this.onChanges(changes))
			)
		);
		this._register(
			this.reconciliationService.onDidRequestReconciliation(() =>
				this.enqueue(() => this.onBurst())
			)
		);

		this.configService.configs.forEach((entry) => this.noteConfig(entry));
		await this.watchPlan();
		this.announce(
			{ kind: "initial" },
			resolvedConfigs(this.configService).map(({ file }) =>
				this.queueRebuild(file, true)
			)
		);
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

	private unseen(
		file: string,
		stream: Stream,
		diagnostics: readonly Diagnostic[]
	): Diagnostic[] {
		return this.printed.unseen(`${file}#${stream}`, diagnostics);
	}

	private noteConfig(entry: ConfigEntry): void {
		const fresh = this.unseen(entry.file, "config", entry.diagnostics);
		const isError = (diagnostic: Diagnostic) =>
			diagnostic.severity === DiagnosticSeverity.Error;
		const errors = fresh.filter(isError);
		const warnings = fresh.filter((diagnostic) => !isError(diagnostic));
		if (errors.length + warnings.length > 0) {
			this.notices.push({ file: entry.file, errors, warnings });
		}
	}

	/** `load` also checks the sync dir, which only changes when the config or its compiler does. */
	private async rebuild(
		file: string,
		load: boolean
	): Promise<RebuildReport | undefined> {
		const entry = this.configService.configs.find(
			(candidate) => candidate.file === file
		);
		const config = entry?.resolved;
		if (!entry || !config) return undefined;
		const failed = (diagnostics: readonly Diagnostic[]): RebuildReport => ({
			entry,
			config,
			outcome: "failed",
			diagnostics: this.unseen(file, "build", diagnostics),
		});

		const built = await this.buildService.build(config, {
			checkSyncDir: load,
		});
		if (built.isErr()) return failed(built.error);
		const written = await this.outputService.write(
			config,
			built.value.tree
		);
		if (written.isErr()) return failed(written.error);

		return {
			entry,
			config,
			outcome: written.value.written ? "wrote" : "unchanged",
			diagnostics: [
				...this.unseen(file, "build", built.value.warnings),
				...(load
					? this.unseen(file, "sync", built.value.syncWarnings)
					: []),
			],
			summary: built.value.summary,
		};
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
		const queued = sequencer.queue(
			this.guarded(() => this.rebuild(file, load))
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
		this.plan = createWatchPlan(resolvedConfigs(this.configService));
		if (this.watchKey() === this.activeWatch) return false;
		await this.watchPlan();
		return true;
	}

	private async reloadConfigs(files: readonly string[]): Promise<string[]> {
		await this.configService.reload(files);
		this.configService.configs.forEach((entry) => this.noteConfig(entry));
		const changed = [...this.changedConfigs];
		this.changedConfigs.clear();
		return changed;
	}

	/** Reloads until the watch plan settles, since a reload can change what's watched. */
	private async applyConfigChanges(
		files: readonly string[]
	): Promise<{ reloaded: string[]; reindexed: boolean }> {
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
		return { reloaded: [...reloaded], reindexed };
	}

	private async onChanges(changes: FileChange[]): Promise<void> {
		const configFiles = changes
			.map((change) => change.path)
			.filter((file) => this.configService.files.has(file));

		let reloaded: string[] = [];
		let reindexed = false;
		if (configFiles.length > 0) {
			({ reloaded, reindexed } =
				await this.applyConfigChanges(configFiles));
		}

		const sourceChanges = changes.filter((change) =>
			this.plan.watches(change.path)
		);
		if (sourceChanges.length > 0) {
			this.indexService.applyChanges(sourceChanges);
		}

		const affected = new Set([
			...reloaded,
			...(reindexed
				? resolvedConfigs(this.configService).map(({ file }) => file)
				: []),
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
				this.queueRebuild(file, reloaded.includes(file))
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
			resolvedConfigs(this.configService).map(({ file }) =>
				this.queueRebuild(file, reloaded.includes(file))
			)
		);
	}
}
