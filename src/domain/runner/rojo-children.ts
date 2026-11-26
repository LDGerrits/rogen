import { Sequencer } from "../../base/async.js";
import { AbstractDisposable, Disposable } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { WatchSession, WatchUpdate } from "../watch/watch-service.js";
import { isWritten } from "../write/write.js";

export interface RojoChild extends Disposable {
	terminate(): Promise<void>;
}

export interface RojoChildHost<C extends RojoChild, A> {
	wanted(): readonly ResolvedConfig[] | undefined;
	problemsIn(projectFiles: readonly string[]): Promise<readonly Diagnostic[]>;
	placeOf?(config: ResolvedConfig): string;
	follow?(child: C, config: ResolvedConfig): void;
	admit(
		config: ResolvedConfig,
		running: C | undefined
	): Promise<A | undefined>;
	start(
		config: ResolvedConfig,
		admission: A,
		signal: AbortSignal
	): Promise<C | undefined>;
	retire?(child: C, reason: "removed" | "moved"): Promise<void>;
	stopped?(children: readonly C[]): Promise<void>;
}

interface Running<C> {
	readonly child: C;
	readonly place: string;
}

/**
 * The Rojo children of a watched Rojo run, one per config. A child starts once
 * its config is first written and restarts only when its place changes, since
 * Rojo reloads its own project file. A config that replaces another with the
 * same place keeps its child. Like Rojo, an error before the first start ends
 * the run, and one after it is only reported.
 */
export class RojoChildren<C extends RojoChild, A> extends AbstractDisposable {
	private readonly _onDidUpdate = this._register(new Emitter<WatchUpdate>());
	readonly onDidUpdate: Event<WatchUpdate> = this._onDidUpdate.event;

	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	private readonly _onDidRefuse = this._register(new Emitter<Error>());
	readonly onDidRefuse: Event<Error> = this._onDidRefuse.event;

	private readonly running = new Map<string, Running<C>>();
	private readonly written = new Set<string>();
	private readonly retiring = new Set<Promise<void>>();
	private readonly reconciling = new Sequencer();
	private readonly halted = new AbortController();
	private started = false;
	private stopping: Promise<void> | undefined;

	constructor(
		private readonly watch: WatchSession,
		private readonly host: RojoChildHost<C, A>
	) {
		super();
		this._register(
			watch.onDidError((error) => {
				if (this.started || this.isHalted) this._onDidError.fire(error);
				else this.refuse(error);
			})
		);
		this._register(
			watch.onDidUpdate((update) => {
				this._onDidUpdate.fire(update);
				this.reconciling
					.queue(() => this.apply(update))
					.catch((error) => this.failed(error));
			})
		);
	}

	get hasStarted(): boolean {
		return this.started;
	}

	get isHalted(): boolean {
		return this.halted.signal.aborted;
	}

	children(): C[] {
		return [...this.running.values()].map(({ child }) => child);
	}

	settled(): Promise<void> {
		return this.reconciling.queue(async () => undefined);
	}

	halt(): void {
		this.halted.abort();
	}

	stop(): Promise<void> {
		this.halt();
		this.stopping ??= (async () => {
			const children = this.children();
			await Promise.all([
				...children.map((child) => child.terminate()),
				...this.retiring,
			]);
			await this.settled();
			await this.host.stopped?.(children);
			await this.watch.stop();
		})();
		return this.stopping;
	}

	override [Symbol.dispose](): void {
		this.halt();
		for (const child of this.children()) child[Symbol.dispose]();
		this.running.clear();
		super[Symbol.dispose]();
	}

	private static async end(child: RojoChild): Promise<void> {
		await child.terminate();
		child[Symbol.dispose]();
	}

	private failed(thrown: unknown): void {
		const error = ErrorUtils.fromUnknown(thrown);
		if (this.started) this._onDidError.fire(error);
		else this.refuse(error);
	}

	private refuse(error: Error): void {
		this.halt();
		this._onDidRefuse.fire(error);
	}

	private async apply(update: WatchUpdate): Promise<void> {
		const files: string[] = [];
		for (const { outcome } of update.reports) {
			if (!isWritten(outcome)) {
				this.written.delete(outcome.config.id);
				continue;
			}
			this.written.add(outcome.config.id);
			files.push(outcome.config.projectFile);
		}
		if (this.isHalted) return;
		const problems = await this.host.problemsIn(files);
		if (this.isHalted) return;
		if (problems.length > 0) {
			const error = new DiagnosticsError(problems);
			if (!this.started) {
				this.refuse(error);
				return;
			}
			this._onDidError.fire(error);
		}
		if (!this.started && this.written.size === 0) return;
		await this.reconcile();
		if (!this.isHalted) this.started = true;
	}

	private async reconcile(): Promise<void> {
		const wanted = this.host.wanted();
		if (wanted === undefined) return;
		const ids = new Set(wanted.map(({ id }) => id));
		for (const [id, running] of [...this.running]) {
			if (ids.has(id)) continue;
			const heir = wanted.find(
				(config) =>
					!this.running.has(config.id) &&
					this.placeOf(config) === running.place
			);
			this.running.delete(id);
			if (heir) this.running.set(heir.id, running);
			else await this.retire(running, "removed");
		}
		for (const config of wanted) await this.follow(config);
	}

	private placeOf(config: ResolvedConfig): string {
		return this.host.placeOf?.(config) ?? config.projectFile;
	}

	private async follow(config: ResolvedConfig): Promise<void> {
		if (this.isHalted) return;
		const { host } = this;
		const place = this.placeOf(config);
		const running = this.running.get(config.id);
		if (running?.place === place) {
			host.follow?.(running.child, config);
			return;
		}
		if (!this.written.has(config.id)) return;
		const admission = await host.admit(config, running?.child);
		if (this.isHalted || admission === undefined) return;
		if (running) {
			this.running.delete(config.id);
			await this.retire(running, "moved");
		}
		if (this.isHalted) return;
		const child = await host.start(config, admission, this.halted.signal);
		if (!child) return;
		if (this.isHalted) {
			await RojoChildren.end(child);
			return;
		}
		this.running.set(config.id, { child, place });
	}

	private async retire(
		running: Running<C>,
		reason: "removed" | "moved"
	): Promise<void> {
		const retired =
			this.host.retire?.(running.child, reason) ??
			RojoChildren.end(running.child);
		this.retiring.add(retired);
		try {
			await retired;
		} finally {
			this.retiring.delete(retired);
		}
	}
}
