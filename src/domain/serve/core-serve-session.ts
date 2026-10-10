import { DeferredPromise, Sequencer } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic, isError } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { isWritten } from "../build/build.js";
import { ResolvedConfig } from "../config/config.js";
import { WatchSession, WatchUpdate } from "../watch/watch-service.js";
import {
	ServeChangeEvent,
	ServePlan,
	ServeSession,
	ServeTarget,
	ServerOutputEvent,
	ServerExitEvent,
	ServerReadyEvent,
	isServed,
} from "./serve-service.js";
import { ServePorts } from "./serve-ports.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-record.js";
import { StartedServer } from "./started-server.js";
import { ServedConfigs } from "./served-configs.js";

/** A watch of the plan's configs, and a server for each config to serve that nothing else serves, kept in step with the configs as they change. */
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

	private readonly _onDidOutput = this._register(
		new Emitter<ServerOutputEvent>()
	);
	readonly onDidOutput: Event<ServerOutputEvent> = this._onDidOutput.event;

	private readonly _onDidChange = this._register(
		new Emitter<ServeChangeEvent>()
	);
	readonly onDidChange: Event<ServeChangeEvent> = this._onDidChange.event;

	private readonly _onDidStop = this._register(
		new Emitter<ServerExitEvent>()
	);
	readonly onDidStop: Event<ServerExitEvent> = this._onDidStop.event;

	private readonly servers = new Map<string, StartedServer>();
	/** The servers being stopped on purpose, which the session's own stop waits for. */
	private readonly retirements = new Set<Promise<void>>();
	/** The configs whose server can't be started at the address they were last seen at, so what the session said of them is said once. */
	private readonly declined = new Map<
		string,
		{ readonly kind: "refused" | "elsewhere"; readonly address: string }
	>();
	/** The configs whose latest build wrote their project file, which a new server can serve. */
	private readonly built = new Set<string>();
	private launched = false;
	private readonly reconciling = new Sequencer();
	/** The first round of builds, or the error that ended it before it said anything. */
	private readonly firstUpdate = new DeferredPromise<
		WatchUpdate | Error | undefined
	>();
	private stopping = false;
	private stopped: Promise<void> | undefined;

	constructor(
		private readonly plan: ServePlan,
		private readonly watch: WatchSession,
		private readonly processService: ProcessService,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly ports: ServePorts
	) {
		super();
		this._register(watch);
		this._register(
			watch.onDidUpdate((update) => {
				for (const { build } of update.reports)
					if (isWritten(build)) this.built.add(build.config.file);
					else this.built.delete(build.config.file);
				if (!this.firstUpdate.isSettled)
					this.firstUpdate.complete(update);
				this._onDidUpdate.fire(update);
				if (this.launched)
					this.reconciling
						.queue(() => this.reconcile())
						.catch((error) =>
							this._onDidError.fire(ErrorUtils.fromUnknown(error))
						);
			})
		);
		this._register(
			watch.onDidError((error) => {
				if (!this.firstUpdate.isSettled)
					this.firstUpdate.complete(error);
				this._onDidError.fire(error);
			})
		);
	}

	get targets(): readonly ServeTarget[] {
		return [...this.servers.values()].map(({ target }) => target);
	}

	async start(): Promise<Result<void, Error>> {
		const watching = await this.watch.start();
		if (watching.isErr()) return watching;
		const first = await this.firstUpdate.p;
		if (!first || this.stopping) return ok(undefined);
		if (first instanceof Error) return err(first);
		const errors = first.reports.flatMap(({ build }) =>
			build.diagnostics.filter(isError)
		);
		if (errors.length > 0) return err(new DiagnosticsError(errors));
		for (const target of this.plan.toStart) this.launch(target);
		for (const { config, address } of this.plan.alreadyServed)
			this.declined.set(config.file, {
				kind: "elsewhere",
				address: address.toString(),
			});
		this.launched = true;
		return ok(undefined);
	}

	/** Ends every server without waiting on a reconcile in flight, which starts nothing once the session stops. */
	stop(): Promise<void> {
		this.stopping = true;
		this.stopped ??= (async () => {
			if (!this.firstUpdate.isSettled)
				this.firstUpdate.complete(undefined);
			const servers = [...this.servers.values()];
			await Promise.all([
				...servers.map((server) => server.terminate()),
				...this.retirements,
			]);
			await Promise.allSettled(
				servers.map((server) => server.unrecord())
			);
			await this.watch.stop();
		})();
		return this.stopped;
	}

	/** Ends the servers if `stop` wasn't awaited, then drops the subscriptions. */
	override [Symbol.dispose](): void {
		this.stop().catch(onUnexpectedError);
		for (const server of this.servers.values()) server[Symbol.dispose]();
		super[Symbol.dispose]();
	}

	/** Starts a server for each config to serve now that has none, and stops those whose config is gone or extended. */
	private async reconcile(): Promise<void> {
		const served = new ServedConfigs(
			this.plan.selection.configs,
			this.plan.named
		);
		const wanted = new Set(served.configs.map(({ file }) => file));
		const present = new Set(served.all.map(({ file }) => file));
		for (const [file, server] of this.servers) {
			if (this.stopping) return;
			if (!wanted.has(file))
				await this.retire(
					server,
					present.has(file) ? "extended" : "removed"
				);
		}
		for (const file of [...this.declined.keys()])
			if (!wanted.has(file)) this.declined.delete(file);
		for (const config of served.configs) {
			if (this.stopping) return;
			await this.follow(config, served);
		}
	}

	/** Serves `config` where its template puts it now, unless it is served there already or can't be. A server moving to a port it can't have stays where it is. */
	private async follow(
		config: ResolvedConfig,
		served: ServedConfigs
	): Promise<void> {
		const { executable, serverArgs } = this.plan;
		const target = await this.ports.targetOf(
			config,
			executable,
			serverArgs
		);
		const address = target.address.toString();
		const started = this.servers.get(config.file);
		if (started?.target.address.toString() === address) return;
		if (!this.built.has(config.file)) return;

		const others = this.targets.filter(
			(other) => other.config.file !== config.file
		);
		const holder = others.find(
			(other) => other.address.port === target.address.port
		);
		const prior = this.declined.get(config.file);
		const declinedHere =
			prior?.address === address ? prior.kind : undefined;
		if (
			!holder &&
			declinedHere &&
			(await this.stillDeclined(target, declinedHere))
		)
			return;
		// Its own server holds the port when only the host moved, so the port has nothing else to tell.
		const samePort = started?.target.address.port === target.address.port;
		const checked = holder
			? err(this.ports.sharedPort(target, holder))
			: started && samePort
				? ok(target)
				: await this.ports.check(
						target,
						others,
						executable.server,
						served.sharesName(target.project)
					);
		if (this.stopping) return;
		await this.settle(target, started, declinedHere, checked);
	}

	/** Says what came of checking `target`, and acts on it: a refusal is said once, a server already serving it is left be, and else the server moves or starts. */
	private async settle(
		target: ServeTarget,
		started: StartedServer | undefined,
		declinedHere: "refused" | "elsewhere" | undefined,
		checked: Result<ServeTarget, Diagnostic>
	): Promise<void> {
		const { file } = target.config;
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
		this.launch(checked.value);
	}

	/** Whether the server at `target`'s address is still as it was when `kind` was declined: only a port that freed up, or a change of the server on it, changes anything, and one probe tells. */
	private async stillDeclined(
		target: ServeTarget,
		kind: "refused" | "elsewhere"
	): Promise<boolean> {
		const state = await this.probe.probe(
			target.address,
			this.plan.executable.server
		);
		const ownProject =
			state.kind === "serving" && state.info.project === target.project;
		return kind === "elsewhere"
			? ownProject
			: state.kind !== "free" && !ownProject;
	}

	private async retire(
		server: StartedServer,
		reason: "removed" | "extended" | "moved"
	): Promise<void> {
		const { target } = server;
		this.servers.delete(target.config.file);
		const retired = server.retire();
		this.retirements.add(retired);
		try {
			await retired;
		} finally {
			this.retirements.delete(retired);
		}
		this._onDidChange.fire({ kind: "retired", target, reason });
	}

	private launch(target: ServeTarget): void {
		if (this.stopping) return;
		const server = new StartedServer(
			target,
			this.plan,
			this.processService,
			this.probe,
			this.records,
			{
				served: (serving) => this._onDidServe.fire(serving),
				said: (said) => this._onDidOutput.fire(said),
				stopped: (stop) => this._onDidStop.fire(stop),
				failed: (error) => this._onDidError.fire(error),
			}
		);
		this.servers.set(target.config.file, server);
	}
}
