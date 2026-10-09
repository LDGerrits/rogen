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
import { WatchSession, WatchUpdate } from "../watch/watch-service.js";
import {
	ServePlan,
	ServeSession,
	ServeTarget,
	ServerSaid,
	ServerStop,
	ServingServer,
} from "./serve-service.js";
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

/** A watch of the plan's configs, and a server for each target nothing served when it started. */
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

	private readonly _onDidStop = this._register(new Emitter<ServerStop>());
	readonly onDidStop: Event<ServerStop> = this._onDidStop.event;

	private readonly children: ChildProcess[] = [];
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
		private readonly records: ServerRecords
	) {
		super();
		this._register(watch);
		this._register(
			watch.onDidUpdate((update) => {
				if (!this.firstUpdate.isSettled)
					this.firstUpdate.complete(update);
				this._onDidUpdate.fire(update);
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
		return ok(undefined);
	}

	stop(): Promise<void> {
		this.stopping = true;
		this.stopped ??= (async () => {
			if (!this.firstUpdate.isSettled)
				this.firstUpdate.complete(undefined);
			for (const timer of this.timers) clearTimeout(timer);
			this.timers.clear();
			await Promise.all(this.children.map((child) => child.terminate()));
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
		this.children.push(child);
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
				if (!this.stopping) this.reportStop(target, exit, said);
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
