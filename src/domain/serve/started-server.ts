import path from "path";
import { AbstractDisposable } from "../../base/disposable.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	ChildProcess,
	ProcessExit,
	ProcessService,
} from "../../platform/process/process-service.js";
import {
	ServePlan,
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

/** What happens to a started server, told to the session that started it. */
export interface StartedServerListener {
	/** It answers for its project. */
	served(serving: ServingServer): void;
	/** It printed something worth showing. */
	said(said: ServerSaid): void;
	/** It stopped before it was told to. */
	stopped(stop: ServerStop): void;
	/** A step of its own failed unexpectedly. */
	failed(error: Error): void;
}

/** A server process the session started for one config, from its start until it is stopped: it reads its output, asks its port until it answers, and records itself once it does. */
export class StartedServer extends AbstractDisposable {
	private readonly child: ChildProcess;
	private exited = false;
	/** Told to stop, by the session or because its config no longer wants it there; its exit is no failure. */
	private ending = false;
	/** The write of its record, once it answered. */
	private record: Promise<void> | undefined;
	/** The next time its port is asked whether it answers yet. */
	private readyTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		readonly target: ServeTarget,
		private readonly plan: ServePlan,
		processService: ProcessService,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly listener: StartedServerListener
	) {
		super();
		const { tool, serverArgs, selection } = plan;
		this.child = this._register(
			processService.spawn(
				tool.file,
				tool.server.serveArgs(
					path.relative(selection.home, target.config.outFile),
					serverArgs
				),
				{ cwd: selection.home }
			)
		);
		const output = this._register(new ServerOutput(tool.server));
		let said = false;
		this._register(this.child.onDidOutput((text) => output.write(text)));
		this._register(
			output.onDidMessage((message) => {
				if (message.severity !== "debug") said = true;
				this.listener.said({ target, message });
			})
		);
		this._register(
			this.child.onDidExit((exit) => {
				this.exited = true;
				output.end();
				if (!this.ending)
					this.listener.stopped(this.stopOf(exit, said));
			})
		);
		this.awaitReady(READY_POLL_MS.first);
	}

	/** Ends the process without a failure to report, and stops asking its port. */
	async terminate(): Promise<void> {
		this.ending = true;
		clearTimeout(this.readyTimer);
		await this.child.terminate();
	}

	/** Ends the process, drops its record and everything it holds. */
	async retire(): Promise<void> {
		await this.terminate();
		await this.unrecord();
		this[Symbol.dispose]();
	}

	/** Drops the record of the server, once its write is done, so no late write outlives it. */
	async unrecord(): Promise<void> {
		if (!this.record) return;
		await this.record;
		await this.records.remove(this.target.address).catch(() => undefined);
	}

	override [Symbol.dispose](): void {
		clearTimeout(this.readyTimer);
		super[Symbol.dispose]();
	}

	/** Asks the server's port until it answers for the project, while it runs. */
	private awaitReady(delay: number): void {
		const { target } = this;
		this.readyTimer = setTimeout(() => {
			this.probe
				.probe(target.address, this.plan.tool.server)
				.then((state) => {
					if (this.ending || this.exited) return;
					if (
						state.kind === "serving" &&
						state.info.project === target.project
					) {
						this.record = this.records
							.write(
								target.address,
								state.info,
								target.config.outFile
							)
							.catch((error) => this.listener.failed(error));
						this.listener.served({ target, info: state.info });
						return;
					}
					this.awaitReady(Math.min(delay * 2, READY_POLL_MS.max));
				})
				.catch((error) => this.listener.failed(error));
		}, delay);
	}

	/** `said` tells whether the server said anything worth showing, which then says why it stopped. */
	private stopOf(exit: ProcessExit, said: boolean): ServerStop {
		const interrupted = wasInterrupted(exit);
		const { server } = this.plan.tool;
		const { label, file } = this.target.config;
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
		const stop = { target: this.target, exit, interrupted };
		return failure
			? {
					...stop,
					failure,
					exitCode:
						exit.code !== null && exit.code !== 0 ? exit.code : 1,
				}
			: stop;
	}
}
