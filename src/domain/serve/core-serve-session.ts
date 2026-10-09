import path from "path";
import { DeferredPromise } from "../../base/async.js";
import { AbstractDisposable, DisposableStore } from "../../base/disposable.js";
import { onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { Result, err, ok } from "../../base/result.js";
import {
	errorDiagnostic,
	isError,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import {
	ChildProcess,
	ProcessExit,
	ProcessService,
} from "../../platform/process/process-service.js";
import { ResolvedConfig } from "../config/config.js";
import { buildableConfig } from "../config/config-service.js";
import { WatchSession, WatchUpdate } from "../watch/watch-service.js";
import { ServedConfigs } from "./serve.js";
import {
	ServeChange,
	ServePlan,
	ServeSession,
	ServeTarget,
	ServerSaid,
	ServerStop,
	ServingServer,
} from "./serve-service.js";
import { ServePorts } from "./serve-ports.js";
import { ServerOutput } from "./server-output.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-record.js";

/** How often a started server is asked whether it serves yet, at first and at most. */
const READY_POLL_MS = { first: 200, max: 1_000 };

/** The exit codes of a program that Ctrl+C or a termination request ended: 128 plus the signal on POSIX, `STATUS_CONTROL_C_EXIT` on Windows. */
const INTERRUPTED_CODES: ReadonlySet<number> = new Set([130, 143, 0xc000013a]);
const INTERRUPTING_SIGNALS: ReadonlySet<string> = new Set([
	"SIGINT",
	"SIGTERM",
]);

const wasInterrupted = ({ code, signal }: ProcessExit) =>
	(signal !== null && INTERRUPTING_SIGNALS.has(signal)) ||
	(code !== null && INTERRUPTED_CODES.has(code));

/** An exit code as its platform shows it: Windows status codes, such as a crash's, in hex. */
const exitCodeText = (code: number) =>
	code > 0x7fffffff ? `0x${code.toString(16).toUpperCase()}` : String(code);

/** A server the session started, by the config it serves. */
interface StartedServer {
	readonly target: ServeTarget;
	readonly child: ChildProcess;
	/** Its output reader and listeners, disposed once it is stopped on purpose. */
	readonly store: DisposableStore;
	exited: boolean;
	/** Stopped on purpose, as its config no longer wants it there; its exit is no failure. */
	retiring: boolean;
	/** The write of its record, once it answered. */
	record?: Promise<void>;
}

const builtOutcomes: ReadonlySet<string> = new Set(["wrote", "unchanged"]);

/** A watch of the plan's configs, and a server for each config to serve that nothing else serves, kept in step with the configs as they change. */
export class CoreServeSession
	extends AbstractDisposable
	implements ServeSession
{
	private readonly _onDidUpdate = this._register(new Emitter<WatchUpdate>());
	readonly onDidUpdate: Event<WatchUpdate> = this._onDidUpdate.event;

	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	private readonly _onDidServe = this._register(new Emitter<ServingServer>());
	readonly onDidServe: Event<ServingServer> = this._onDidServe.event;

	private readonly _onDidSay = this._register(new Emitter<ServerSaid>());
	readonly onDidSay: Event<ServerSaid> = this._onDidSay.event;

	private readonly _onDidChange = this._register(new Emitter<ServeChange>());
	readonly onDidChange: Event<ServeChange> = this._onDidChange.event;

	private readonly _onDidStop = this._register(new Emitter<ServerStop>());
	readonly onDidStop: Event<ServerStop> = this._onDidStop.event;

	private readonly servers = new Map<string, StartedServer>();
	/** The servers being stopped on purpose, which the session's own stop waits for. */
	private readonly retirements = new Set<Promise<void>>();
	/** The address of each config a server the session didn't start serves. */
	private readonly servedElsewhere = new Map<string, string>();
	/** The configs whose latest build wrote their project file, which a new server can serve. */
	private readonly built = new Set<string>();
	/** The address each config to serve was refused at, so a refusal is said once. */
	private readonly refused = new Map<string, string>();
	private launched = false;
	private reconciling: Promise<void> = Promise.resolve();
	/** The first round of builds, or the error that ended it before it said anything. */
	private readonly firstUpdate = new DeferredPromise<
		WatchUpdate | Error | undefined
	>();
	private readonly timers = new Set<ReturnType<typeof setTimeout>>();
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
					if (builtOutcomes.has(build.outcome))
						this.built.add(build.config.file);
					else this.built.delete(build.config.file);
				if (!this.firstUpdate.isSettled)
					this.firstUpdate.complete(update);
				this._onDidUpdate.fire(update);
				if (this.launched)
					this.reconciling = this.reconciling
						.then(() => this.reconcile())
						.catch((error) => this._onDidError.fire(error));
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
		await this.watch.start();
		const first = await this.firstUpdate.p;
		if (!first || this.stopping) return ok(undefined);
		if (first instanceof Error) return err(first);
		const errors = first.reports.flatMap(({ build }) =>
			build.diagnostics.filter(isError)
		);
		if (errors.length > 0) return err(new DiagnosticsError(errors));
		for (const target of this.plan.toStart) this.launch(target);
		for (const { config, address } of this.plan.running)
			this.servedElsewhere.set(config.file, address.toString());
		this.launched = true;
		return ok(undefined);
	}

	/** Ends every server without waiting on a reconcile in flight, which starts nothing once the session stops. */
	stop(): Promise<void> {
		this.stopping = true;
		this.stopped ??= (async () => {
			if (!this.firstUpdate.isSettled)
				this.firstUpdate.complete(undefined);
			for (const timer of this.timers) clearTimeout(timer);
			this.timers.clear();
			const servers = [...this.servers.values()];
			await Promise.all([
				...servers.map(({ child }) => child.terminate()),
				...this.retirements,
			]);
			await Promise.allSettled(
				servers.map((server) => this.unrecord(server))
			);
			await this.watch.stop();
		})();
		return this.stopped;
	}

	/** Ends the servers if `stop` wasn't awaited, then drops the subscriptions. */
	override [Symbol.dispose](): void {
		this.stop().catch(onUnexpectedError);
		for (const { store } of this.servers.values()) store[Symbol.dispose]();
		super[Symbol.dispose]();
	}

	/** Starts a server for each config to serve now that has none, and stops those whose config is gone or extended. */
	private async reconcile(): Promise<void> {
		const served = new ServedConfigs(
			this.plan.selection.entries.flatMap(
				(entry) => buildableConfig(entry) ?? []
			),
			this.plan.named
		);
		const wanted = new Set(served.configs.map(({ file }) => file));
		const present = new Set(
			this.plan.selection.entries.map(({ file }) => file)
		);
		for (const [file, server] of this.servers)
			if (!wanted.has(file))
				await this.retire(
					server,
					present.has(file) ? "extended" : "removed"
				);
		for (const known of [this.servedElsewhere, this.refused])
			for (const file of [...known.keys()])
				if (!wanted.has(file)) known.delete(file);
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
		const { tool, serverArgs } = this.plan;
		const target = await this.ports.targetOf(config, tool, serverArgs);
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
		const refusedHere = this.refused.get(config.file) === address;
		const elsewhere = this.servedElsewhere.get(config.file) === address;
		if (!holder && (refusedHere || elsewhere)) {
			// Only a port that freed up, or a server that left it, changes anything, and one probe tells.
			const state = await this.probe.probe(target.address, tool.server);
			if (elsewhere && state.kind === "serving") return;
			if (refusedHere && state.kind !== "free") return;
		}
		// Its own server holds the port only when nothing but the host moved.
		const samePort = started?.target.address.port === target.address.port;
		if (started && samePort) await this.retire(started, "moved");
		const checked = holder
			? err(this.ports.sharedPort(target, holder))
			: await this.ports.check(
					target,
					others,
					tool.server,
					served.sharesName(target.project)
				);
		if (this.stopping) return;
		if (checked.isErr()) {
			if (!refusedHere)
				this._onDidChange.fire({
					kind: "refused",
					target,
					diagnostic: checked.error,
				});
			this.refused.set(config.file, address);
			return;
		}
		this.refused.delete(config.file);
		if (started && !samePort) await this.retire(started, "moved");
		if (checked.value.running) {
			if (!elsewhere)
				this._onDidChange.fire({
					kind: "running",
					target: checked.value,
				});
			this.servedElsewhere.set(config.file, address);
			return;
		}
		this.servedElsewhere.delete(config.file);
		this.launch(checked.value);
	}

	private async retire(
		server: StartedServer,
		reason: "removed" | "extended" | "moved"
	): Promise<void> {
		const { target } = server;
		server.retiring = true;
		this.servers.delete(target.config.file);
		const retired = (async () => {
			await server.child.terminate();
			await this.unrecord(server);
			server.store[Symbol.dispose]();
		})();
		this.retirements.add(retired);
		try {
			await retired;
		} finally {
			this.retirements.delete(retired);
		}
		this._onDidChange.fire({ kind: "retired", target, reason });
	}

	/** Drops the record of `server`, once its write is done, so no late write outlives it. */
	private async unrecord(server: StartedServer): Promise<void> {
		if (!server.record) return;
		await server.record;
		await this.records.remove(server.target.address).catch(() => undefined);
	}

	private launch(target: ServeTarget): void {
		if (this.stopping) return;
		const { tool, serverArgs, selection } = this.plan;
		const store = new DisposableStore();
		const child = store.add(
			this.processService.spawn(
				tool.file,
				tool.server.serveArgs(
					path.relative(selection.home, target.config.outFile),
					serverArgs
				),
				{ cwd: selection.home }
			)
		);
		const server: StartedServer = {
			target,
			child,
			store,
			exited: false,
			retiring: false,
		};
		this.servers.set(target.config.file, server);
		const output = store.add(new ServerOutput(tool.server));
		let said = false;
		store.add(child.onDidOutput((text) => output.write(text)));
		store.add(
			output.onDidMessage((message) => {
				if (message.severity !== "debug") said = true;
				this._onDidSay.fire({ target, message });
			})
		);
		store.add(
			child.onDidExit((exit) => {
				server.exited = true;
				output.end();
				if (!this.stopping && !server.retiring)
					this.reportStop(target, exit, said);
			})
		);
		this.awaitReady(server, READY_POLL_MS.first);
	}

	/** Asks the server's port until it answers for the project, while it runs. */
	private awaitReady(server: StartedServer, delay: number): void {
		const { target } = server;
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			this.probe
				.probe(target.address, this.plan.tool.server)
				.then((state) => {
					if (this.stopping || server.exited || server.retiring)
						return;
					if (
						state.kind === "serving" &&
						state.info.project === target.project
					) {
						server.record = this.records
							.write(
								target.address,
								state.info,
								target.config.outFile
							)
							.catch((error) => this._onDidError.fire(error));
						this._onDidServe.fire({ target, info: state.info });
						return;
					}
					this.awaitReady(
						server,
						Math.min(delay * 2, READY_POLL_MS.max)
					);
				})
				.catch((error) => this._onDidError.fire(error));
		}, delay);
		this.timers.add(timer);
	}

	/** `said` tells whether the server said anything worth showing, which then says why it stopped. */
	private reportStop(
		target: ServeTarget,
		exit: ProcessExit,
		said: boolean
	): void {
		const interrupted = wasInterrupted(exit);
		const { server } = this.plan.tool;
		const { label, file } = target.config;
		const failure =
			exit.error !== undefined
				? errorDiagnostic(
						"serve.serverExited",
						{ resource: file },
						`${server.name} couldn't start to serve ${label}: ${exit.error.message}`
					)
				: !interrupted && exit.code !== 0
					? errorDiagnostic(
							"serve.serverExited",
							{ resource: file },
							`${server.name} stopped serving ${label} with ${exit.code === null ? `signal ${exit.signal}` : `exit code ${exitCodeText(exit.code)}`}${said ? "; see what it said above." : ", without saying why."}`
						)
					: undefined;
		this._onDidStop.fire({
			target,
			exit,
			interrupted,
			failure,
			...(failure && {
				exitCode: exit.code !== null && exit.code !== 0 ? exit.code : 1,
			}),
		});
	}
}
