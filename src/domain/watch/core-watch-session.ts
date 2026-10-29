import { Sequencer } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import path from "path";
import { ignoringGlob } from "../../base/glob.js";
import { samePath, toPosix } from "../../base/path.js";
import { Result, ok, tryWithAsync } from "../../base/result.js";
import { FileChange, FileChangeType } from "../../platform/fs/file-changes.js";
import { IndexService, Listing } from "../../platform/fs/index-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { WriteSet } from "../write/write.js";
import { WriteService } from "../write/write-service.js";
import { ConfigNotice, ReloadableSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ChangeBatcher } from "./change-batcher.js";
import { WatchedConfig } from "./watched-config.js";
import { WatchPlan } from "./watch-plan.js";
import {
	RewriteReport,
	WatchCause,
	WatchOptions,
	WatchSession,
	WatchUpdate,
	ChangeBurst,
} from "./watch-service.js";

/** A running watch; rewrites of one config never overlap. */
export class CoreWatchSession
	extends AbstractDisposable
	implements WatchSession
{
	private readonly _onDidUpdate = this._register(new Emitter<WatchUpdate>());
	readonly onDidUpdate: Event<WatchUpdate> = this._onDidUpdate.event;

	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	private readonly batcher: ChangeBatcher;
	/** Batches compiled output apart from the sources: it only starts a check, so any amount of it is one round. */
	private readonly compiledBatcher: ChangeBatcher;
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

	constructor(
		private readonly selection: ReloadableSelection,
		private writeSet: WriteSet,
		private readonly watcher: Watcher,
		private readonly indexService: IndexService,
		private readonly writeService: WriteService,
		private readonly options: WatchOptions = {}
	) {
		super();
		this.batcher = this._register(new ChangeBatcher());
		this.compiledBatcher = this._register(
			new ChangeBatcher({ burstThreshold: Infinity })
		);
		this.plan = new WatchPlan(this.selection.configs);
	}

	get configs(): readonly ResolvedConfig[] {
		return this.writeSet.configs;
	}

	async start(): Promise<Result<void, Error>> {
		if (this.starting) throw new Error("A watch starts once.");
		this.starting = true;
		this._register(
			this.watcher.onDidChangeFile((changes) => {
				const compiled: FileChange[] = [];
				const others: FileChange[] = [];
				for (const change of this.dropSourceUpdates(changes))
					(this.plan.isCompiled(change.path)
						? compiled
						: others
					).push(change);
				if (others.length > 0) this.batcher.queueEvents(others);
				if (compiled.length > 0)
					this.compiledBatcher.queueEvents(compiled);
			})
		);
		this._register(
			this.batcher.onDidEmitChanges((changes) =>
				this.enqueue(() => this.onChanges(changes))
			)
		);
		this._register(
			this.compiledBatcher.onDidEmitChanges((changes) =>
				this.enqueue(() => this.onCompiledChanges(changes))
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
				this.queueRewrite(projectFile)
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
		const { contentEdits } = this.options;
		if (contentEdits)
			return changes.filter(
				(change) =>
					this.isWatched(change.path) &&
					!contentEdits.ignoring.some((file) =>
						samePath(file, change.path)
					) &&
					!(
						change.type === FileChangeType.UPDATED &&
						this.isLeftOut(change.path)
					)
			);
		const watched = [...this.watched.values()];
		if (!this.started || watched.some((config) => !config.readsKnown)) {
			return changes.filter((change) => this.isWatched(change.path));
		}
		return changes.filter(
			(change) =>
				this.isWatched(change.path) &&
				(change.type !== FileChangeType.UPDATED ||
					this.plan.isCompiled(change.path) ||
					this.selection.reads(change.path) ||
					watched.some((config) => config.reads(change.path)))
		);
	}

	/** Whether every project that reads `file` leaves it out by its `globIgnorePaths`, so an edit of it changes nothing Rojo reads. */
	private isLeftOut(file: string): boolean {
		const projects = this.plan.projectsFor(file);
		const owners = this.selection.configs.filter(({ projectFile }) =>
			projects.includes(projectFile)
		);
		return (
			owners.length > 0 &&
			owners.every(
				({ ignored }) =>
					ignoringGlob(toPosix(path.resolve(file)), ignored) !==
					undefined
			)
		);
	}

	private isWatched(file: string): boolean {
		return (
			!this.selection.followedFolder ||
			this.selection.concerns(file) ||
			this.selection.reads(file) ||
			this.plan.watches(file) ||
			this.plan.isCompiled(file)
		);
	}

	private async rewrite(
		watched: WatchedConfig,
		projectFile: string,
		force: boolean
	): Promise<RewriteReport | undefined> {
		if (!this.writeSet.configOf(projectFile)) return undefined;
		return watched.finished(
			await this.writeService.rewrite(
				this.writeSet,
				projectFile,
				this.listing,
				watched.latest,
				force
			)
		);
	}

	private async recheck(
		watched: WatchedConfig,
		projectFile: string,
		changes: readonly FileChange[]
	): Promise<RewriteReport | undefined> {
		const { latest } = watched;
		if (!latest || !this.writeSet.configOf(projectFile)) return undefined;
		const outcome = await this.writeService.recheck(
			this.writeSet,
			projectFile,
			this.listing,
			latest,
			changes
		);
		if (outcome === latest) return undefined;
		const report = watched.finished(outcome);
		return report.unreported.length > 0 || report.fixed.length > 0
			? report
			: undefined;
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

	private queueRewrite(
		projectFile: string,
		force = false
	): Promise<RewriteReport | undefined> {
		return this.queueFor(projectFile, (config) =>
			this.rewrite(config, projectFile, force)
		);
	}

	private queueRecheck(
		projectFile: string,
		changes: readonly FileChange[]
	): Promise<RewriteReport | undefined> {
		return this.queueFor(projectFile, (config) =>
			this.recheck(config, projectFile, changes)
		);
	}

	private queueFor(
		projectFile: string,
		task: (config: WatchedConfig) => Promise<RewriteReport | undefined>
	): Promise<RewriteReport | undefined> {
		let watched = this.watched.get(projectFile);
		if (!watched) {
			watched = new WatchedConfig();
			this.watched.set(projectFile, watched);
		}
		const config = watched;
		const queued = config.queue(this.guarded(() => task(config)));
		this.track(queued);
		return queued;
	}

	private enqueue(task: () => Promise<void>): void {
		this.track(this.intake.queue(this.guarded(task)));
	}

	private announce(
		cause: WatchCause,
		results: readonly Promise<RewriteReport | undefined>[],
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
						rewrote: cause.kind !== "compiled",
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
		return [
			...this.selection.files,
			...this.plan.roots,
			...this.plan.compiledRoots,
		];
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
		this.writeSet = new WriteSet(this.selection.configs);
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

		const metaChanged = new Set(
			sourceChanges
				.filter(
					({ type, path: file }) =>
						type !== FileChangeType.UPDATED &&
						file.endsWith(".meta.json")
				)
				.flatMap(({ path: file }) => this.plan.projectsFor(file))
		);
		const affected = new Set([
			...this.selection.configs
				.filter(({ file }) => reindexed || reloaded.includes(file))
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
			[...affected].map((file) =>
				this.queueRewrite(file, metaChanged.has(file))
			),
			sourceChanges
		);
	}

	private async onCompiledChanges(changes: FileChange[]): Promise<void> {
		const indexed = changes.filter((change) =>
			this.plan.watches(change.path)
		);
		if (indexed.length > 0)
			this.listing = await this.indexService.update(
				this.listing,
				indexed
			);
		const projects = new Set(
			changes.flatMap((change) => this.plan.compiledFor(change.path))
		);
		this.announce(
			{ kind: "compiled", files: changes.length },
			[...projects].map((file) =>
				this.queueRecheck(
					file,
					changes.filter((change) =>
						this.plan.compiledFor(change.path).includes(file)
					)
				)
			),
			changes
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
				this.queueRewrite(projectFile)
			)
		);
	}
}
