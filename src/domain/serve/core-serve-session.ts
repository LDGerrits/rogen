import { DeferredPromise, Sequencer, timeout } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { Result, err, ok } from "../../base/result.js";
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
import { ServePorts } from "./serve-ports.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-records.js";
import { StartedServer } from "./started-server.js";

const RECORD_POLL_MS = 250;

const RECORD_WAIT_MS = 5_000;

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

	private readonly _onDidExit = this._register(
		new Emitter<ServerExitEvent>()
	);
	readonly onDidExit: Event<ServerExitEvent> = this._onDidExit.event;

	private readonly servers = new Map<string, StartedServer>();
	private readonly retirements = new Set<Promise<void>>();
	private readonly declined = new Map<
		string,
		{ readonly kind: "refused" | "elsewhere"; readonly address: string }
	>();
	private readonly writtenConfigs = new Set<string>();
	private readonly reconciling = new Sequencer();
	private readonly firstLaunch = new DeferredPromise<
		Result<void, Error> | Promise<Result<void, Error>>
	>();
	private readonly exits = new Sequencer();
	private stopping = false;
	private readonly halted = new AbortController();
	private stopped: Promise<void> | undefined;

	constructor(
		private readonly plan: ServePlan,
		private readonly watch: WatchSession,
		private readonly rojoRunner: RojoRunner,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly ports: ServePorts,
		private readonly compatibility: RojoCompatibility
	) {
		super();
		this._register(watch);
		this._register(
			watch.onDidUpdate((update) => {
				for (const { outcome } of update.reports) {
					if (!isWritten(outcome)) {
						this.writtenConfigs.delete(outcome.config.id);
						continue;
					}
					this.writtenConfigs.add(outcome.config.id);
				}
				const first = !this.firstLaunch.isSettled;
				if (first)
					this.firstLaunch.complete(
						this.reconciling.queue(() => this.launchFirst(update))
					);
				this._onDidUpdate.fire(update);
				if (!first)
					this.reconciling
						.queue(async () => {
							if (!(await this.launchedFirst())) return;
							await this.reportIncompatible(update);
							await this.reconcile();
						})
						.catch((error) =>
							this._onDidError.fire(ErrorUtils.fromUnknown(error))
						);
			})
		);
		this._register(
			watch.onDidError((error) => {
				this.firstLaunch.complete(err(error));
				this._onDidError.fire(error);
			})
		);
	}

	get target(): ServeTarget | undefined {
		return [...this.servers.values()][0]?.target;
	}

	async start(): Promise<Result<void, Error>> {
		const watching = await this.watch.start();
		if (watching.isErr()) {
			this._onDidError.fire(watching.error);
			return watching;
		}
		return this.firstLaunch.p;
	}

	stop(): Promise<void> {
		this.stopping = true;
		this.halted.abort();
		this.stopped ??= (async () => {
			this.firstLaunch.complete(ok(undefined));
			const servers = [...this.servers.values()];
			await Promise.all([
				...servers.map((server) => server.terminate()),
				...this.retirements,
			]);
			await Promise.allSettled(
				servers.map((server) => server.unrecord())
			);
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

	/** Ends any orphan, checks the Rojo that runs and starts the target's server for the first update; later updates queue behind it. */
	private async launchFirst(
		first: WatchUpdate
	): Promise<Result<void, Error>> {
		if (this.stopping) return ok(undefined);
		const incompatible = await this.compatibility.problemsIn(
			this.plan.executable,
			first.reports.flatMap(({ outcome }) =>
				isWritten(outcome) ? [outcome.config.projectFile] : []
			),
			"serve"
		);
		if (incompatible.length > 0) {
			const refusal = new DiagnosticsError(incompatible);
			this._onDidError.fire(refusal);
			return err(refusal);
		}
		const { target } = this.plan;
		if (!this.writtenConfigs.has(target.config.id)) return ok(undefined);
		if (!isServed(target)) {
			await this.endOrphanOf(target);
			this.launch(target);
		} else
			this.declined.set(target.config.id, {
				kind: "elsewhere",
				address: target.address.toString(),
			});
		return ok(undefined);
	}

	/** Whether the first launch went ahead; a session that refused to start serves nothing on later updates. */
	private async launchedFirst(): Promise<boolean> {
		try {
			return (await this.firstLaunch.p).isOk();
		} catch {
			return false;
		}
	}

	private async reportIncompatible(update: WatchUpdate): Promise<void> {
		const problems = await this.compatibility.problemsIn(
			this.plan.executable,
			update.reports.flatMap(({ outcome }) =>
				isWritten(outcome) ? [outcome.config.projectFile] : []
			),
			"serve"
		);
		if (problems.length > 0)
			this._onDidError.fire(new DiagnosticsError(problems));
	}

	private async reconcile(): Promise<void> {
		const { selection } = this.plan;
		const { configs } = selection;
		const wanted = new Set(configs.map(({ id }) => id));
		for (const [file, server] of this.servers) {
			if (this.stopping) return;
			if (!wanted.has(file)) await this.retire(server, "removed");
		}
		for (const file of [...this.declined.keys()])
			if (!wanted.has(file)) this.declined.delete(file);
		for (const config of configs) {
			if (this.stopping) return;
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
		if (this.stopping) return;
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
		const state = await this.probe.probe(target.address);
		const recorded =
			state.kind === "serving"
				? await this.ports.recordFor(target, state.info)
				: undefined;
		if (kind === "refused") return state.kind !== "free" && !recorded;
		return recorded !== undefined && !this.ports.ownerEnded(recorded);
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
		if (!orphan?.pid || this.stopping) return;
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

	/** Reports the stop, as a stand-down when the server failed to start because another serve's took its address first; that wait ends with the session. */
	private stoppedServer(stop: ServerExitEvent, served: boolean): void {
		if (stop.kind !== "failed" || served) {
			this._onDidExit.fire(stop);
			return;
		}
		this.exits
			.queue(async () => {
				const servedBy = await this.waitForAnotherServe(stop.target);
				if (this.stopping) return;
				this._onDidExit.fire(
					servedBy
						? {
								kind: "served-elsewhere",
								target: stop.target,
								servedBy,
							}
						: stop
				);
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
			const served = await this.ports.anotherServeAt(target);
			if (served !== "pending") return served;
			await timeout(RECORD_POLL_MS, signal);
		}
		return undefined;
	}

	private launch(target: ServeTarget): void {
		if (this.stopping) return;
		const server: StartedServer = new StartedServer(
			target,
			this.plan,
			this.rojoRunner,
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
