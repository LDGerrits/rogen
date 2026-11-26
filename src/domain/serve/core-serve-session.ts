import { DeferredPromise, Sequencer, timeout } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { ok } from "../../base/result.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoChildren } from "../runner/rojo-children.js";
import { RojoCompatibility } from "../runner/rojo-compatibility.js";
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

/**
 * How long the shutdown that a server interrupted with Rogen means is waited
 * for, since on Windows its exit can come first.
 */
const SHUTDOWN_GRACE_MS = 1_000;

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

	private readonly children: RojoChildren<StartedServer, Admitted>;
	private readonly declined = new Map<
		string,
		{ readonly kind: "refused" | "elsewhere"; readonly address: string }
	>();
	private readonly exits = new Sequencer();
	private readonly halted = new AbortController();
	private readonly ending = new DeferredPromise<ServeEnding>();
	private stopped: Promise<void> | undefined;

	constructor(
		private readonly plan: ServePlan,
		private readonly watch: WatchSession,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly ports: ServePorts,
		compatibility: RojoCompatibility,
		@ProcessService private readonly processService: ProcessService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {
		super();
		this._register(watch);
		this.children = this._register(
			new RojoChildren<StartedServer, Admitted>(watch, {
				wanted: () => this.wanted(),
				problemsIn: (files) =>
					compatibility.problemsIn(plan.executable, files, "serve"),
				placeOf: (config) =>
					`${config.projectFile}\n${ports.targetOf(config).address.toString()}`,
				follow: (server, config) =>
					server.follow(ports.targetOf(config)),
				admit: (config, running) => this.admit(config, running),
				start: (config, admitted, signal) =>
					this.start(config, admitted, signal),
				retire: (server, reason) => this.retire(server, reason),
				stopped: (servers) => this.unrecord(servers),
			})
		);
		this._register(
			this.children.onDidUpdate((update) =>
				this._onDidUpdate.fire(update)
			)
		);
		this._register(
			this.children.onDidError((error) => this._onDidError.fire(error))
		);
		this._register(
			this.children.onDidRefuse((error) =>
				this.halt({ kind: "refused", error })
			)
		);
		this._register(
			watch.onDidError((error) => {
				if (this.children.hasStarted || this.isHalted)
					this._onDidError.fire(error);
				else this.halt({ kind: "refused", error });
			})
		);
	}

	get target(): ServeTarget | undefined {
		return this.children.children()[0]?.target;
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
		this.children.halt();
		this.ending.complete(ending);
	}

	private shutdownAfter(ending: ServeEnding): ServeEnding {
		if (ending.kind === "refused") return ending;
		const exit =
			ending.kind === "exited" && ending.exit.kind !== "interrupted"
				? ending.exit
				: undefined;
		const ended = this.target;
		return {
			kind: "shutdown",
			...(exit && { exit }),
			...(ended &&
				ended.config.id !== exit?.target.config.id && { ended }),
		};
	}

	private stop(): Promise<void> {
		this.halt({ kind: "shutdown" });
		this.stopped ??= this.children.stop();
		return this.stopped;
	}

	override [Symbol.dispose](): void {
		this.stop().catch(onUnexpectedError);
		super[Symbol.dispose]();
	}

	private async unrecord(servers: readonly StartedServer[]): Promise<void> {
		await Promise.all(servers.map((server) => server.unrecord()));
		await this.exits.queue(async () => undefined);
	}

	private wanted(): readonly ResolvedConfig[] {
		const { selection } = this.plan;
		const configs = selection.configs.filter(
			({ file }) => !selection.nestedWriters.has(file)
		);
		const wanted = new Set(configs.map(({ id }) => id));
		for (const file of [...this.declined.keys()])
			if (!wanted.has(file)) this.declined.delete(file);
		return configs;
	}

	private async admit(
		config: ResolvedConfig,
		running: StartedServer | undefined
	): Promise<Admitted | undefined> {
		const planned = this.plan.target;
		if (!this.children.hasStarted && config.id === planned.config.id) {
			return { target: planned, quiet: true };
		}
		const target = this.ports.targetOf(config);
		const address = target.address.toString();
		const prior = this.declined.get(config.id);
		const declinedHere =
			prior?.address === address ? prior.kind : undefined;
		if (declinedHere && (await this.stillDeclined(target, declinedHere)))
			return undefined;
		const samePort = running?.target.address.port === target.address.port;
		const checked =
			running && samePort ? ok(target) : await this.ports.check(target);
		if (this.isHalted) return undefined;
		if (checked.isErr()) {
			if (declinedHere !== "refused")
				this._onDidChange.fire({
					kind: "refused",
					target,
					diagnostic: checked.error,
				});
			this.declined.set(config.id, { kind: "refused", address });
			return undefined;
		}
		return { target: checked.value, quiet: declinedHere === "elsewhere" };
	}

	private async start(
		config: ResolvedConfig,
		admitted: Admitted,
		signal: AbortSignal
	): Promise<StartedServer | undefined> {
		const { target, quiet } = admitted;
		const address = target.address.toString();
		if (isServed(target)) {
			if (!quiet)
				this._onDidChange.fire({ kind: "servedElsewhere", target });
			this.declined.set(config.id, { kind: "elsewhere", address });
			return undefined;
		}
		this.declined.delete(config.id);
		await this.endOrphanOf(target);
		if (signal.aborted) return undefined;
		return this.launch(target);
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
		await server.retire();
		this._onDidChange.fire({ kind: "retired", target, reason });
	}

	private async endOrphanOf(target: ServeTarget): Promise<void> {
		const { orphan } = target;
		if (
			!orphan?.pid ||
			this.isHalted ||
			!this.processService.isRunning(orphan.pid)
		)
			return;
		const state = await this.probe.probe(target.address);
		if (state.kind !== "serving" || state.info.session !== orphan.session)
			return;
		let error: string | undefined;
		try {
			await this.processService.terminateTree(orphan.pid);
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

	private stoppedServer(stop: ServerExitEvent, server: StartedServer): void {
		if (stop.kind !== "failed" || server.hasServed) {
			this.halt({ kind: "exited", exit: stop });
			return;
		}
		this.exits
			.queue(async () => {
				const servedBy = await this.waitForAnotherServe(stop.target);
				server.release(!servedBy);
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

	private launch(target: ServeTarget): StartedServer {
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
				stopped: (stop) => this.stoppedServer(stop, server),
				failed: (error) => this._onDidError.fire(error),
				restarted: (serving) => this._onDidRestart.fire(serving),
			},
			() => this.watch.refresh()
		);
		return server;
	}
}

interface Admitted {
	readonly target: ServeTarget;
	readonly quiet: boolean;
}
