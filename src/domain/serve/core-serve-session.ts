import { DeferredPromise, Sequencer, timeout } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { isWritten } from "../write/write.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoCompatibility } from "../runner/rojo-compatibility.js";
import { RojoRunner } from "../runner/rojo-runner.js";
import { ServerInfo } from "../runner/rojo-server.js";
import { WatchSession, WatchUpdate } from "../watch/watch-service.js";
import {
	ServeChangeEvent,
	ServeEnding,
	ServePlan,
	ServeSession,
	ServeTarget,
	ServerConnectionEvent,
	ServerOutputEvent,
	ServerExitEvent,
	ServerReadyEvent,
	ServerRestartEvent,
	isServed,
} from "./serve-service.js";
import { ServePorts, refuses } from "./serve-ports.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-records.js";
import { StartedServer } from "./started-server.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";

const RECORD_POLL_MS = 250;

const RECORD_WAIT_MS = 5_000;

/** How long the shutdown that a server interrupted with Rogen means is waited for, since on Windows its exit can come first. */
const SHUTDOWN_GRACE_MS = 1_000;

/** Watches the plan's configs and keeps a started server for each config to serve. */
export class CoreServeSession
	extends AbstractDisposable
	implements ServeSession
{
	private readonly _onDidUpdate = this._register(new Emitter<WatchUpdate>());
	readonly onDidUpdate: Event<WatchUpdate> = this._onDidUpdate.event;

	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	private readonly _onDidServe = this._register(
		new Emitter<ServerReadyEvent>()
	);
	readonly onDidServe: Event<ServerReadyEvent> = this._onDidServe.event;

	private readonly _onDidRestart = this._register(
		new Emitter<ServerRestartEvent>()
	);
	readonly onDidRestart: Event<ServerRestartEvent> = this._onDidRestart.event;

	private readonly _onDidConnect = this._register(
		new Emitter<ServerConnectionEvent>()
	);
	readonly onDidConnect: Event<ServerConnectionEvent> =
		this._onDidConnect.event;

	private readonly _onDidOutput = this._register(
		new Emitter<ServerOutputEvent>()
	);
	readonly onDidOutput: Event<ServerOutputEvent> = this._onDidOutput.event;

	private readonly _onDidChange = this._register(
		new Emitter<ServeChangeEvent>()
	);
	readonly onDidChange: Event<ServeChangeEvent> = this._onDidChange.event;

	private readonly servers = new Map<string, StartedServer>();
	private readonly retirements = new Set<Promise<void>>();
	private readonly declined = new Map<
		string,
		{ readonly kind: "refused" | "elsewhere"; readonly address: string }
	>();
	private readonly writtenConfigs = new Set<string>();
	private readonly reconciling = new Sequencer();
	private readonly exits = new Sequencer();
	/** Whether the first launch is done, so later writes only follow the configs. */
	private launched = false;
	/** Aborts once the session ends, for whichever reason came first; every step after it does nothing. */
	private readonly halted = new AbortController();
	private readonly ending = new DeferredPromise<ServeEnding>();
	private stopped: Promise<void> | undefined;

	constructor(
		private readonly plan: ServePlan,
		private readonly watch: WatchSession,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly ports: ServePorts,
		private readonly compatibility: RojoCompatibility,
		@RojoRunner private readonly rojoRunner: RojoRunner,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {
		super();
		this._register(watch);
		this._register(
			watch.onDidUpdate((update) => {
				this._onDidUpdate.fire(update);
				this.reconciling
					.queue(() => this.applyUpdate(update))
					.catch((error) =>
						this._onDidError.fire(ErrorUtils.fromUnknown(error))
					);
			})
		);
		this._register(
			watch.onDidError((error) => {
				if (this.launched || this.isHalted)
					this._onDidError.fire(error);
				else this.halt({ kind: "refused", error });
			})
		);
	}

	get target(): ServeTarget | undefined {
		return [...this.servers.values()][0]?.target;
	}

	async run(shutdown: AbortSignal): Promise<ServeEnding> {
		const onShutdown = () => this.stop().catch(onUnexpectedError);
		if (shutdown.aborted) onShutdown();
		else shutdown.addEventListener("abort", onShutdown, { once: true });
		try {
			const watching = await this.watch.start();
			if (watching.isErr())
				this.halt({ kind: "refused", error: watching.error });
			const ending = await this.ending.p;
			if (ending.kind === "exited" && ending.exit.kind === "interrupted")
				await timeout(SHUTDOWN_GRACE_MS, shutdown);
			await this.stop();
			return shutdown.aborted ? this.shutdownAfter(ending) : ending;
		} finally {
			shutdown.removeEventListener("abort", onShutdown);
		}
	}

	private get isHalted(): boolean {
		return this.halted.signal.aborted;
	}

	private halt(ending: ServeEnding): void {
		if (this.isHalted) return;
		this.halted.abort();
		this.ending.complete(ending);
	}

	/** The shutdown's ending, telling a server's stop that came first unless the shutdown caused it, and the server the shutdown ended when it is another. */
	private shutdownAfter(ending: ServeEnding): ServeEnding {
		if (ending.kind === "refused") return ending;
		const exit =
			ending.kind === "exited" && ending.exit.kind !== "interrupted"
				? ending.exit
				: undefined;
		const ended =
			this.target ??
			(ending.kind === "exited" ? ending.exit.target : undefined);
		return {
			kind: "shutdown",
			...(exit && { exit }),
			...(ended &&
				ended.config.id !== exit?.target.config.id && { ended }),
		};
	}

	private stop(): Promise<void> {
		this.halt({ kind: "shutdown" });
		this.stopped ??= (async () => {
			const servers = [...this.servers.values()];
			await Promise.all([
				...servers.map((server) => server.terminate()),
				...this.retirements,
			]);
			await Promise.all(servers.map((server) => server.unrecord()));
			await this.exits.queue(async () => undefined);
			await this.watch.stop();
		})();
		return this.stopped;
	}

	override [Symbol.dispose](): void {
		this.stop().catch(onUnexpectedError);
		for (const server of this.servers.values()) server[Symbol.dispose]();
		super[Symbol.dispose]();
	}

	/** Records what the update wrote in its own turn, so a first launch serves only configs it checked; later updates only report the Rojo that runs. */
	private async applyUpdate(update: WatchUpdate): Promise<void> {
		for (const { outcome } of update.reports) {
			if (!isWritten(outcome)) {
				this.writtenConfigs.delete(outcome.config.id);
				continue;
			}
			this.writtenConfigs.add(outcome.config.id);
		}
		if (this.isHalted) return;
		if (this.launched) {
			await this.reportIncompatible(update);
			await this.reconcile();
			return;
		}
		try {
			await this.launchFirst(update);
		} catch (error) {
			this.halt({
				kind: "refused",
				error: ErrorUtils.fromUnknown(error),
			});
		}
	}

	/** Ends any orphan, checks the Rojo that runs and starts the target's server; waits for another write while no config is written yet. */
	private async launchFirst(update: WatchUpdate): Promise<void> {
		const incompatible = await this.problemsIn(update);
		if (this.isHalted) return;
		if (incompatible.length > 0) {
			this.halt({
				kind: "refused",
				error: new DiagnosticsError(incompatible),
			});
			return;
		}
		if (this.writtenConfigs.size === 0) return;
		const { target } = this.plan;
		if (!this.writtenConfigs.has(target.config.id)) await this.reconcile();
		else if (!isServed(target)) {
			await this.endOrphanOf(target);
			if (this.isHalted) return;
			this.launch(target);
		} else
			this.declined.set(target.config.id, {
				kind: "elsewhere",
				address: target.address.toString(),
			});
		this.launched = true;
	}

	/** What the Rojo that runs can't serve of the project files `update` wrote. */
	private problemsIn(update: WatchUpdate): Promise<Diagnostic[]> {
		return this.compatibility.problemsIn(
			this.plan.executable,
			update.reports.flatMap(({ outcome }) =>
				isWritten(outcome) ? [outcome.config.projectFile] : []
			),
			"serve"
		);
	}

	private async reportIncompatible(update: WatchUpdate): Promise<void> {
		const problems = await this.problemsIn(update);
		if (problems.length > 0)
			this._onDidError.fire(new DiagnosticsError(problems));
	}

	private async reconcile(): Promise<void> {
		const { selection } = this.plan;
		const { configs } = selection;
		const wanted = new Set(configs.map(({ id }) => id));
		for (const [file, server] of this.servers) {
			if (this.isHalted) return;
			if (!wanted.has(file)) await this.retire(server, "removed");
		}
		for (const file of [...this.declined.keys()])
			if (!wanted.has(file)) this.declined.delete(file);
		for (const config of configs) {
			if (this.isHalted) return;
			await this.follow(config);
		}
	}

	private async follow(config: ResolvedConfig): Promise<void> {
		const target = this.ports.targetOf(config);
		const address = target.address.toString();
		const started = this.servers.get(config.id);
		if (started?.target.address.toString() === address) {
			started.follow(target);
			return;
		}
		if (!this.writtenConfigs.has(config.id)) return;

		const prior = this.declined.get(config.id);
		const declinedHere =
			prior?.address === address ? prior.kind : undefined;
		if (declinedHere && (await this.stillDeclined(target, declinedHere)))
			return;
		const samePort = started?.target.address.port === target.address.port;
		const checked =
			started && samePort ? ok(target) : await this.ports.check(target);
		if (this.isHalted) return;
		await this.settle(target, started, declinedHere, checked);
	}

	private async settle(
		target: ServeTarget,
		started: StartedServer | undefined,
		declinedHere: "refused" | "elsewhere" | undefined,
		checked: Result<ServeTarget, Diagnostic>
	): Promise<void> {
		const file = target.config.id;
		const address = target.address.toString();
		if (checked.isErr()) {
			if (declinedHere !== "refused")
				this._onDidChange.fire({
					kind: "refused",
					target,
					diagnostic: checked.error,
				});
			this.declined.set(file, { kind: "refused", address });
			return;
		}
		if (started) await this.retire(started, "moved");
		if (isServed(checked.value)) {
			if (declinedHere !== "elsewhere")
				this._onDidChange.fire({
					kind: "servedElsewhere",
					target: checked.value,
				});
			this.declined.set(file, { kind: "elsewhere", address });
			return;
		}
		this.declined.delete(file);
		await this.endOrphanOf(checked.value);
		this.launch(checked.value);
	}

	private async stillDeclined(
		target: ServeTarget,
		kind: "refused" | "elsewhere"
	): Promise<boolean> {
		const holder = await this.ports.classify(target);
		return kind === "refused" ? refuses(holder) : holder.kind === "ours";
	}

	private async retire(
		server: StartedServer,
		reason: "removed" | "moved"
	): Promise<void> {
		const { target } = server;
		this.servers.delete(target.config.id);
		const retired = server.retire();
		this.retirements.add(retired);
		try {
			await retired;
		} finally {
			this.retirements.delete(retired);
		}
		this._onDidChange.fire({ kind: "retired", target, reason });
	}

	/** Ends the server a `rogen serve` that ended left holding the target's port, so its own can start; leaves it when it is gone by now. */
	private async endOrphanOf(target: ServeTarget): Promise<void> {
		const { orphan } = target;
		if (
			!orphan?.pid ||
			this.isHalted ||
			!this.rojoRunner.isRunning(orphan.pid)
		)
			return;
		const state = await this.probe.probe(target.address);
		if (state.kind !== "serving" || state.info.session !== orphan.session)
			return;
		let error: string | undefined;
		try {
			await this.rojoRunner.terminateTree(orphan.pid);
		} catch (thrown) {
			error = ErrorUtils.fromUnknown(thrown).message;
		}
		this._onDidChange.fire({
			kind: "orphan",
			target,
			pid: orphan.pid,
			owner: orphan.owner,
			...(error !== undefined && { error }),
		});
	}

	/** Ends the session with the stop, as a stand-down when the server failed to start because another serve's took its address first; that wait ends with the session. */
	private stoppedServer(stop: ServerExitEvent, served: boolean): void {
		if (stop.kind !== "failed" || served) {
			this.halt({ kind: "exited", exit: stop });
			return;
		}
		this.exits
			.queue(async () => {
				const servedBy = await this.waitForAnotherServe(stop.target);
				this.halt({
					kind: "exited",
					exit: servedBy
						? {
								kind: "served-elsewhere",
								target: stop.target,
								servedBy,
							}
						: stop,
				});
			})
			.catch((error) =>
				this._onDidError.fire(ErrorUtils.fromUnknown(error))
			);
	}

	/** The server another `rogen serve` started on the target's address first, which kept this one from starting; waits a little for its record, until the session stops. */
	private async waitForAnotherServe(
		target: ServeTarget
	): Promise<ServerInfo | undefined> {
		const { signal } = this.halted;
		for (
			let waited = 0;
			waited <= RECORD_WAIT_MS && !signal.aborted;
			waited += RECORD_POLL_MS
		) {
			const holder = await this.ports.classify(target);
			if (holder.kind === "ours") return holder.info;
			if (holder.kind !== "pending") return undefined;
			await timeout(RECORD_POLL_MS, signal);
		}
		return undefined;
	}

	private launch(target: ServeTarget): void {
		if (this.isHalted) return;
		const server: StartedServer = this.instantiationService.createInstance(
			StartedServer,
			target,
			this.plan,
			this.probe,
			this.records,
			{
				served: (serving) => this._onDidServe.fire(serving),
				said: (said) => this._onDidOutput.fire(said),
				connection: (change) => this._onDidConnect.fire(change),
				stopped: (stop) => this.stoppedServer(stop, server.hasServed),
				failed: (error) => this._onDidError.fire(error),
				restarted: (serving) => this._onDidRestart.fire(serving),
			},
			() => this.watch.refresh()
		);
		this.servers.set(target.config.id, server);
	}
}
