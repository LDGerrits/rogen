import { Sequencer } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { Result, ok, tryWithAsync } from "../../base/result.js";
import { FileChange, FileChangeType } from "../../platform/fs/file-changes.js";
import { IndexService, Listing } from "../../platform/fs/index-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { BuildSet } from "../build/build.js";
import { BuildService } from "../build/build-service.js";
import { ConfigNotice, ReloadableSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ChangeBatcher } from "./change-batcher.js";
import { WatchedConfig } from "./watched-config.js";
import { WatchPlan } from "./watch-plan.js";
import {
	RebuildReport,
	WatchCause,
	WatchSession,
	WatchUpdate,
	ChangeBurst,
} from "./watch-service.js";

/** A running watch; rebuilds of one config never overlap. */
export class CoreWatchSession
	extends AbstractDisposable
	implements WatchSession
{
	private readonly _onDidUpdate = this._register(new Emitter<WatchUpdate>());
	readonly onDidUpdate: Event<WatchUpdate> = this._onDidUpdate.event;

	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	private readonly batcher: ChangeBatcher;
	private readonly intake = new Sequencer();
	private readonly updates = new Sequencer();
	private readonly watched = new Map<string, WatchedConfig>();
	private readonly pending = new Set<Promise<void>>();
	private starting = false;
	private started = false;
	private notices: ConfigNotice[] = [];
	private plan: WatchPlan;
	private listing = Listing.EMPTY;
	private activeWatch = "";
	private stopping: Promise<void> | undefined;

	get configs(): readonly ResolvedConfig[] {
		return this.buildSet.configs;
	}

	constructor(
		private readonly selection: ReloadableSelection,
		private buildSet: BuildSet,
		private readonly watcher: Watcher,
		private readonly indexService: IndexService,
		private readonly buildService: BuildService
	) {
		super();
		this.batcher = this._register(new ChangeBatcher());
		this.plan = new WatchPlan(this.selection.configs);
	}

	async start(): Promise<Result<void, Error>> {
		if (this.starting) throw new Error("A watch starts once.");
		this.starting = true;
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

		const watching = await tryWithAsync(() => this.watchPlan());
		if (watching.isErr()) return watching;
		this.announce(
			{ kind: "initial" },
			this.selection.configs.map(({ projectFile }) =>
				this.queueRebuild(projectFile)
			)
		);
		this.started = true;
		return ok(undefined);
	}

	stop(): Promise<void> {
		this.stopping ??= (async () => {
			await Promise.allSettled([...this.pending]);
			await this.watcher.stop();
		})();
		return this.stopping;
	}

	override [Symbol.dispose](): void {
		this.stop().catch(onUnexpectedError);
		super[Symbol.dispose]();
	}

	private dropSourceUpdates(changes: readonly FileChange[]): FileChange[] {
		const watched = [...this.watched.values()];
		if (!this.started || watched.some((config) => !config.readsKnown)) {
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

	private isWatched(file: string): boolean {
		return (
			!this.selection.followedFolder ||
			this.selection.concerns(file) ||
			this.selection.reads(file) ||
			this.plan.watches(file)
		);
	}

	private async rebuild(
		watched: WatchedConfig,
		projectFile: string
	): Promise<RebuildReport | undefined> {
		if (!this.buildSet.configOf(projectFile)) return undefined;
		return watched.finished(
			await this.buildService.rebuild(
				this.buildSet,
				projectFile,
				this.listing,
				watched.latest
			)
		);
	}

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
		projectFile: string
	): Promise<RebuildReport | undefined> {
		let watched = this.watched.get(projectFile);
		if (!watched) {
			watched = new WatchedConfig();
			this.watched.set(projectFile, watched);
		}
		const config = watched;
		const queued = config.queue(
			this.guarded(() => this.rebuild(config, projectFile))
		);
		this.track(queued);
		return queued;
	}

	private enqueue(task: () => Promise<void>): void {
		this.track(this.intake.queue(this.guarded(task)));
	}

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

	private get shallowDirs(): string[] {
		return this.selection.followedFolder
			? [this.selection.followedFolder]
			: [];
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

	private async refreshPlan(): Promise<boolean> {
		this.plan = new WatchPlan(this.selection.configs);
		if (this.watchKey() === this.activeWatch) return false;
		await this.watchPlan();
		return true;
	}

	private refreshSet(): void {
		this.buildSet = new BuildSet(this.selection.configs);
	}

	private forgetRemoved(): void {
		const current = new Set(
			this.selection.configs.map(({ projectFile }) => projectFile)
		);
		for (const projectFile of this.watched.keys())
			if (!current.has(projectFile)) this.watched.delete(projectFile);
	}

	private async reloadConfigs(
		files: readonly string[]
	): Promise<readonly string[]> {
		const { changed, notices } = await this.selection.reload(files);
		this.notices.push(...notices);
		return changed;
	}

	private async applyConfigChanges(files: readonly string[]): Promise<{
		reloaded: string[];
		reindexed: boolean;
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
			toReload = [...this.selection.files];
		}
		this.refreshSet();
		this.forgetRemoved();
		return { reloaded: [...reloaded], reindexed };
	}

	private async onChanges(changes: FileChange[]): Promise<void> {
		const configFiles = changes
			.map((change) => change.path)
			.filter((file) => this.selection.concerns(file));

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
			this.listing = await this.indexService.update(
				this.listing,
				sourceChanges
			);
		}

		const affected = new Set([
			...this.selection.configs
				.filter(
					({ rootFile }) => reindexed || reloaded.includes(rootFile)
				)
				.map(({ projectFile }) => projectFile),
			...sourceChanges.flatMap((change) =>
				this.plan.projectsFor(change.path)
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
			this.selection.configs.map(({ projectFile }) =>
				this.queueRebuild(projectFile)
			)
		);
	}
}
