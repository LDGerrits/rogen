import { DeferredPromise, aborted } from "../../base/async.js";
import { AbstractDisposable, DisposableStore } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ReloadableSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { WatchSession, WatchUpdate } from "../watch/watch-service.js";
import {
	RojoCommandRun,
	RojoRunEnding,
	RojoRunWatch,
} from "./rojo-command-service.js";
import { RojoChildren } from "./rojo-children.js";
import { RojoRestartEvent, ServerExecutable } from "./rojo-runner.js";
import { WatchingRojo } from "./watching-rojo.js";

export interface RojoVerbStarter {
	find(
		project: ResolvedConfig,
		signal?: AbortSignal
	): Promise<Result<ServerExecutable, Error>>;
	problemsIn(
		executable: ServerExecutable,
		projectFiles: readonly string[]
	): Promise<Diagnostic[]>;
	watch(
		executable: ServerExecutable,
		project: ResolvedConfig,
		beforeRestart: () => Promise<void>
	): WatchingRojo;
}

export class WatchedRojoRun extends AbstractDisposable implements RojoRunWatch {
	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	private readonly _onDidRun = this._register(
		new Emitter<Result<RojoCommandRun, Error>>()
	);
	readonly onDidRun: Event<Result<RojoCommandRun, Error>> =
		this._onDidRun.event;

	private readonly _onDidRestart = this._register(
		new Emitter<RojoRestartEvent>()
	);
	readonly onDidRestart: Event<RojoRestartEvent> = this._onDidRestart.event;

	readonly onDidUpdate: Event<WatchUpdate>;

	private readonly children: RojoChildren<WatchingRojo, true>;
	private readonly listeners = this._register(new DisposableStore());
	private readonly failed = new DeferredPromise<Error>();
	private executable: ServerExecutable | undefined;

	constructor(
		private readonly selection: ReloadableSelection,
		private readonly watch: WatchSession,
		private readonly starter: RojoVerbStarter
	) {
		super();
		this._register(watch);
		this.children = this._register(
			new RojoChildren<WatchingRojo, true>(watch, {
				wanted: () => {
					const valid = selection.requireValid();
					return valid.isOk() ? valid.value.slice(0, 1) : undefined;
				},
				problemsIn: (files) => this.problemsIn(files),
				admit: async () => true,
				start: (project, _admitted, signal) =>
					this.start(project, signal),
			})
		);
		this.onDidUpdate = this.children.onDidUpdate;
		this._register(
			this.children.onDidError((error) => this._onDidError.fire(error))
		);
		this._register(
			this.children.onDidRefuse((error) => this.failed.complete(error))
		);
	}

	get home(): string {
		return this.selection.home;
	}

	get notes(): readonly string[] {
		return this.selection.notes;
	}

	get configs(): readonly ResolvedConfig[] {
		return this.watch.configs;
	}

	async run(shutdown: AbortSignal): Promise<Result<RojoRunEnding, Error>> {
		try {
			const started = await this.watch.start();
			if (started.isErr()) return started;
			const failure = await Promise.race([
				aborted(shutdown).then(() => undefined),
				this.failed.p,
			]);
			return ok(
				failure
					? { kind: "failed", error: failure }
					: { kind: "stopped" }
			);
		} finally {
			await this.children.stop();
		}
	}

	private async find(
		project: ResolvedConfig,
		signal?: AbortSignal
	): Promise<Result<ServerExecutable, Error>> {
		if (this.executable) return ok(this.executable);
		const found = await this.starter.find(project, signal);
		if (found.isOk()) this.executable = found.value;
		return found;
	}

	private async problemsIn(
		projectFiles: readonly string[]
	): Promise<readonly Diagnostic[]> {
		if (projectFiles.length === 0) return [];
		const executable = await this.find(this.selection.configs[0]);
		return executable.isOk()
			? this.starter.problemsIn(executable.value, projectFiles)
			: [];
	}

	private async start(
		project: ResolvedConfig,
		signal: AbortSignal
	): Promise<WatchingRojo | undefined> {
		const executable = await this.find(project, signal);
		if (signal.aborted) return undefined;
		if (executable.isErr()) {
			this._onDidRun.fire(err(executable.error));
			return undefined;
		}
		const child = this.starter.watch(executable.value, project, () =>
			this.watch.refresh()
		);
		const { listeners } = this;
		child.onDidRun((run) => this._onDidRun.fire(ok(run)), listeners);
		child.onDidRestart(
			(restart) => this._onDidRestart.fire(restart),
			listeners
		);
		child.onDidExit(({ failure }) => {
			if (failure) this.failed.complete(failure);
		}, listeners);
		return child;
	}
}
