import path from "path";
import { RunOnceScheduler } from "../../base/async.js";
import { ErrorUtils } from "../../base/errors.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	ChildProcess,
	ProcessExit,
	ProcessService,
	exitCodeText,
	wasInterrupted,
} from "../../platform/process/process-service.js";
import {
	ServePlan,
	ServeTarget,
	ServerOutputEvent,
	ServerExitEvent,
	ServerReadyEvent,
} from "./serve-service.js";
import { ServerOutput } from "./server-output.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-record.js";

/** How often a started server is asked whether it serves yet, at first and at most. */
const READY_POLL_MS = { first: 200, max: 1_000 };

/** What happens to a started server, told to the session that started it. */
export interface StartedServerListener {
	/** It answers for its project. */
	served(serving: ServerReadyEvent): void;
	/** It printed something worth showing. */
	said(said: ServerOutputEvent): void;
	/** It stopped before it was told to. */
	stopped(stop: ServerExitEvent): void;
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
	private readonly ready: RunOnceScheduler;
	private readyDelay = READY_POLL_MS.first;

	constructor(
		readonly target: ServeTarget,
		private readonly plan: ServePlan,
		processService: ProcessService,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly listener: StartedServerListener
	) {
		super();
		const { executable, serverArgs, selection } = plan;
		this.child = this._register(
			processService.spawn(
				executable.file,
				executable.server.serveArgs(
					path.relative(selection.home, target.config.outFile),
					serverArgs
				),
				{ cwd: selection.home }
			)
		);
		const output = this._register(new ServerOutput(executable.server));
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
		this.ready = this._register(
			new RunOnceScheduler(() => this.askReady(), READY_POLL_MS.first)
		);
		this.ready.schedule();
	}

	/** Ends the process without a failure to report, and stops asking its port. */
	async terminate(): Promise<void> {
		this.ending = true;
		this.ready.cancel();
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

	/** Asks the server's port whether it answers for the project, and asks again later while it runs and doesn't. */
	private askReady(): void {
		const { target } = this;
		this.probe
			.probe(target.address, this.plan.executable.server)
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
						.catch((error) =>
							this.listener.failed(ErrorUtils.fromUnknown(error))
						);
					this.listener.served({ target, info: state.info });
					return;
				}
				this.readyDelay = Math.min(
					this.readyDelay * 2,
					READY_POLL_MS.max
				);
				this.ready.schedule(this.readyDelay);
			})
			.catch((error) =>
				this.listener.failed(ErrorUtils.fromUnknown(error))
			);
	}

	/** `said` tells whether the server said anything worth showing, which then says why it stopped. */
	private stopOf(exit: ProcessExit, said: boolean): ServerExitEvent {
		const interrupted = wasInterrupted(exit);
		const { server } = this.plan.executable;
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
