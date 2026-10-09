import path from "path";
import { DeferredPromise } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
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
import { buildableConfig } from "../config/config-service.js";
import { WatchSession, WatchUpdate } from "../watch/watch-service.js";
import { leafConfigs } from "./serve.js";
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
	/** Stopped on purpose, as its config no longer wants it there; its exit is no failure. */
	retiring: boolean;
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
	/** The configs a server the session didn't start serves. */
	private readonly servedElsewhere = new Set<string>();
	/** The configs whose latest build wrote their project file, which a new server can serve. */
	private readonly built = new Set<string>();
	/** Why each config to serve couldn't be, by the address it was refused at, so a refusal is said once. */
	private readonly refused = new Map<string, string>();
	private launched = false;
	private reconciling: Promise<void> = Promise.resolve();
	/** The targets whose server answered, which the session wrote a record for. */
	private readonly recorded: ServeTarget[] = [];
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
		for (const { config } of this.plan.running)
			this.servedElsewhere.add(config.file);
		this.launched = true;
		return ok(undefined);
	}

	stop(): Promise<void> {
		this.stopping = true;
		this.stopped ??= (async () => {
			if (!this.firstUpdate.isSettled)
				this.firstUpdate.complete(undefined);
			for (const timer of this.timers) clearTimeout(timer);
			this.timers.clear();
			await this.reconciling;
			await Promise.all(
				[...this.servers.values()].map(({ child }) => child.terminate())
			);
			await Promise.allSettled(
				this.recorded.map(({ address }) => this.records.remove(address))
			);
			await this.watch.stop();
		})();
		return this.stopped;
	}

	/** Ends the servers if `stop` wasn't awaited, then drops the subscriptions. */
	override [Symbol.dispose](): void {
		this.stop().catch(onUnexpectedError);
		super[Symbol.dispose]();
	}

	/** Starts a server for each config to serve now that has none, and stops those whose config is gone, extended or moved. */
	private async reconcile(): Promise<void> {
		const { selection, tool, serverArgs, named } = this.plan;
		const configs = selection.entries.flatMap(
			(entry) => buildableConfig(entry) ?? []
		);
		const leaves = leafConfigs(configs);
		const wanted = named
			? configs.filter(({ file }) => named.has(file))
			: leaves;
		const wantedFiles = new Set(wanted.map(({ file }) => file));
		const present = new Set(configs.map(({ file }) => file));

		for (const [file, server] of this.servers)
			if (!wantedFiles.has(file))
				await this.retire(
					server,
					present.has(file) ? "extended" : "removed"
				);
		for (const file of this.servedElsewhere)
			if (!wantedFiles.has(file)) this.servedElsewhere.delete(file);

		// A name that several servable configs share can't tell which of them a server serves.
		const servable = new Set([...leaves, ...wanted]);
		const sharedName = (project: string) =>
			[...servable].filter(({ name }) => name === project).length > 1;
		for (const config of wanted) {
			if (this.stopping) return;
			const target = await this.ports.targetOf(config, tool, serverArgs);
			const address = target.address.toString();
			const started = this.servers.get(config.file);
			if (started) {
				if (started.target.address.toString() === address) continue;
				await this.retire(started, "moved");
			}
			if (this.servedElsewhere.has(config.file)) continue;
			if (!this.built.has(config.file)) continue;
			const others = this.targets;
			const holder = others.find(
				(other) => other.address.port === target.address.port
			);
			const checked = holder
				? err(this.ports.sharedPort(target, holder))
				: await this.ports.check(
						target,
						others,
						tool.server,
						sharedName(target.project)
					);
			if (this.stopping) return;
			if (checked.isErr()) {
				if (this.refused.get(config.file) !== address)
					this._onDidChange.fire({
						kind: "refused",
						target,
						diagnostic: checked.error,
					});
				this.refused.set(config.file, address);
				continue;
			}
			this.refused.delete(config.file);
			if (checked.value.running) {
				this.servedElsewhere.add(config.file);
				this._onDidChange.fire({
					kind: "running",
					target: checked.value,
				});
			} else this.launch(checked.value);
		}
	}

	private async retire(
		server: StartedServer,
		reason: "removed" | "extended" | "moved"
	): Promise<void> {
		const { target } = server;
		server.retiring = true;
		this.servers.delete(target.config.file);
		await server.child.terminate();
		const index = this.recorded.indexOf(target);
		if (index !== -1) {
			this.recorded.splice(index, 1);
			await this.records.remove(target.address).catch(() => undefined);
		}
		this._onDidChange.fire({ kind: "retired", target, reason });
	}

	private launch(target: ServeTarget): void {
		const { tool, serverArgs, selection } = this.plan;
		const child = this._register(
			this.processService.spawn(
				tool.file,
				tool.server.serveArgs(
					path.relative(selection.home, target.config.outFile),
					serverArgs
				),
				{ cwd: selection.home }
			)
		);
		const server: StartedServer = { target, child, retiring: false };
		this.servers.set(target.config.file, server);
		const output = this._register(new ServerOutput(tool.server));
		let said = false;
		this._register(child.onDidOutput((text) => output.write(text)));
		this._register(
			output.onDidMessage((message) => {
				if (message.severity !== "debug") said = true;
				this._onDidSay.fire({ target, message });
			})
		);
		let exited = false;
		this._register(
			child.onDidExit((exit) => {
				exited = true;
				output.end();
				if (!this.stopping && !server.retiring)
					this.reportStop(target, exit, said);
			})
		);
		this.awaitReady(target, () => exited, READY_POLL_MS.first);
	}

	/** Asks the target's port until its server answers for the project, while the server runs. */
	private awaitReady(
		target: ServeTarget,
		exited: () => boolean,
		delay: number
	): void {
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			this.probe
				.probe(target.address, this.plan.tool.server)
				.then((state) => {
					if (this.stopping || exited()) return;
					if (
						state.kind === "serving" &&
						state.info.project === target.project
					) {
						this.recorded.push(target);
						void this.records
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
						target,
						exited,
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
