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
} from "../../platform/process/process-service.js";
import { BuildSetting, sameSetting, settingOf } from "../build/build.js";
import { ResolvedConfig } from "../config/config.js";
import { ServerInfo } from "./serve.js";
import {
	ServePlan,
	ServeTarget,
	ServerOutputEvent,
	ServerExitEvent,
	ServerReadyEvent,
} from "./serve-service.js";
import { ServerOutput } from "./server-output.js";
import { PortState, ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-records.js";

/** How often a started server is asked whether it serves yet, at first and at most. */
const READY_POLL_MS = { first: 200, max: 1_000 };

/** How long a started server may go without answering for its project before the user is told. */
const SLOW_START_MS = 10_000;

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

/** A server the session serves a config with, whether it started the process or adopted one that was already running. */
export interface RunningServer {
	readonly target: ServeTarget;
	/** Ends what the session holds of it: its process if it started one, else only its watching. */
	terminate(): Promise<void>;
	/** Terminates it, drops its record and everything it holds. */
	retire(): Promise<void>;
	/** Drops its record, if it has one. */
	unrecord(): Promise<void>;
	[Symbol.dispose](): void;
}

/** A server process the session started for one config, from its start until it is stopped: it reads its output, asks its port until it answers, and records itself once it does. */
export class StartedServer extends AbstractDisposable implements RunningServer {
	private readonly child: ChildProcess;
	private exited = false;
	/** Told to stop, by the session or because its config no longer wants it there; its exit is no failure. */
	private ending = false;
	/** The write of its record, once it answered. */
	private record: Promise<void> | undefined;
	/** What the server said when it answered, which its record keeps naming. */
	private answering: ServerInfo | undefined;
	/** The mode and variants of the build its project file holds. */
	private setting: BuildSetting;
	/** The next time its port is asked whether it answers yet. */
	private readonly ready: RunOnceScheduler;
	private readyDelay = READY_POLL_MS.first;
	private readonly startedAt = Date.now();
	private toldSlow = false;

	constructor(
		readonly target: ServeTarget,
		private readonly plan: ServePlan,
		processService: ProcessService,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly listener: StartedServerListener
	) {
		super();
		this.setting = settingOf(target.config);
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
		this._register(
			this.child.onDidOutputLine((line) => output.readLine(line))
		);
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

	/** Notes that the config was built again, as the server's project file now holds that build: when its mode or variants changed since the record was written, the record says so. */
	async rebuilt(config: ResolvedConfig): Promise<void> {
		const setting = settingOf(config);
		if (sameSetting(setting, this.setting)) return;
		this.setting = setting;
		if (!this.record || !this.answering || this.ending || this.exited)
			return;
		const info = this.answering;
		this.record = this.record.then(() =>
			this.ending || this.exited ? undefined : this.writeRecord(info)
		);
		await this.record;
	}

	private writeRecord(info: ServerInfo): Promise<void> {
		const { target } = this;
		return this.records
			.write(target.address, info, {
				projectFile: target.config.outFile,
				setting: this.setting,
			})
			.catch((error) =>
				this.listener.failed(ErrorUtils.fromUnknown(error))
			);
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
					this.answering = state.info;
					this.record = this.writeRecord(state.info);
					this.listener.served({ target, info: state.info });
					return;
				}
				this.warnWhenSlow(state);
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

	/** Says once that the server has not answered for its project in a while, and what does answer on its port, if anything; it goes on asking. */
	private warnWhenSlow(state: PortState): void {
		if (this.toldSlow || Date.now() - this.startedAt < SLOW_START_MS)
			return;
		this.toldSlow = true;
		const { target } = this;
		const { server } = this.plan.executable;
		const where = `port ${target.address.port}`;
		this.listener.said({
			target,
			message: {
				severity: "warning",
				text:
					state.kind === "free"
						? `${server.name} hasn't answered on ${where} yet; still waiting.`
						: `${where} is answered by something other than ${server.name} serving ${target.project}, so ${target.config.label} may not be served there. Stop what holds it, or give it another port.`,
			},
		});
	}

	/** `said` tells whether the server said anything worth showing, which then says why it stopped. */
	private stopOf(exit: ProcessExit, said: boolean): ServerExitEvent {
		const interrupted = exit.interrupted === true;
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
