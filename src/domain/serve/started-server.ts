import path from "path";
import { RunOnceScheduler } from "../../base/async.js";
import { ErrorUtils } from "../../base/errors.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	ProcessExit,
	exitCodeText,
} from "../../platform/process/process-service.js";
import { RojoProcess, RojoRunner } from "../runner/rojo-runner.js";
import { ServerInfo } from "../runner/rojo-server.js";
import { ServeFlags } from "../runner/serve-flags.js";
import {
	ServePlan,
	ServeTarget,
	ServerConnectionEvent,
	ServerOutputEvent,
	ServerExitEvent,
	ServerReadyEvent,
} from "./serve-service.js";
import { PortState, ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-records.js";

const READY_POLL_MS = { first: 200, max: 1_000 };

const SLOW_START_MS = 10_000;

interface StartedServerListener {
	served(serving: ServerReadyEvent): void;
	said(said: ServerOutputEvent): void;
	stopped(stop: ServerExitEvent): void;
	connection(change: ServerConnectionEvent): void;
	failed(error: Error): void;
}

/** A server the session started to serve a config with. */
export class StartedServer extends AbstractDisposable {
	private readonly child: RojoProcess;
	private exited = false;
	private stoppedOnPurpose = false;
	private recordWrite: Promise<void> | undefined;
	private connected = 0;
	private readonly ready: RunOnceScheduler;
	private readyDelay = READY_POLL_MS.first;
	private readonly startedAt = Date.now();
	private toldSlow = false;

	constructor(
		readonly target: ServeTarget,
		private readonly plan: ServePlan,
		rojoRunner: RojoRunner,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly listener: StartedServerListener
	) {
		super();
		const { executable, serverArgs, selection } = plan;
		this.child = this._register(
			rojoRunner.start(
				executable,
				"serve",
				path.relative(selection.home, target.config.projectFile),
				ServeFlags.portIn(serverArgs).unwrapOr(undefined) === undefined
					? [...serverArgs, "--port", String(target.address.port)]
					: serverArgs,
				selection.home
			)
		);
		let said = false;
		this._register(
			this.child.onDidConnection((change) => {
				if (this.stoppedOnPurpose || this.exited) return;
				const opened = change === "opened";
				this.connected = Math.max(
					0,
					this.connected + (opened ? 1 : -1)
				);
				this.listener.connection({
					target,
					opened,
					clients: this.connected,
				});
			})
		);
		this._register(
			this.child.onDidMessage((message) => {
				if (message.severity !== "debug") said = true;
				this.listener.said({ target, message });
			})
		);
		this._register(
			this.child.onDidExit((exit) => {
				this.exited = true;
				if (!this.stoppedOnPurpose)
					this.listener.stopped(this.stopOf(exit, said));
			})
		);
		this.ready = this._register(
			new RunOnceScheduler(() => this.askReady(), READY_POLL_MS.first)
		);
		this.ready.schedule();
	}

	async terminate(): Promise<void> {
		this.stoppedOnPurpose = true;
		this.ready.cancel();
		await this.child.terminate();
	}

	/** Terminates it and drops its record and everything it holds. */
	async retire(): Promise<void> {
		await this.terminate();
		await this.unrecord();
		this[Symbol.dispose]();
	}

	private writeRecord(info: ServerInfo): Promise<void> {
		const { target } = this;
		return this.records
			.write(target.address, info, {
				projectFile: target.config.projectFile,
				configFile: target.config.file,
				pid: this.child.pid,
			})
			.catch((error) =>
				this.listener.failed(ErrorUtils.fromUnknown(error))
			);
	}

	async unrecord(): Promise<void> {
		if (!this.recordWrite) return;
		await this.recordWrite;
		await this.records.remove(this.target.address).catch(() => undefined);
	}

	private askReady(): void {
		const { target } = this;
		this.probe
			.probe(target.address)
			.then((state) => {
				if (this.stoppedOnPurpose || this.exited) return;
				if (
					state.kind === "serving" &&
					state.info.project === target.project
				) {
					this.recordWrite = this.writeRecord(state.info);
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

	private warnWhenSlow(state: PortState): void {
		if (this.toldSlow || Date.now() - this.startedAt < SLOW_START_MS)
			return;
		this.toldSlow = true;
		const { target } = this;
		const where = `port ${target.address.port}`;
		this.listener.said({
			target,
			message: {
				severity: "warning",
				text:
					state.kind === "free"
						? `Rojo hasn't answered on ${where} yet; still waiting.`
						: `${where} is answered by something other than Rojo serving ${target.project}, so ${target.config.label} may not be served there. Stop what holds it, or give it another port.`,
			},
		});
	}

	private stopOf(exit: ProcessExit, said: boolean): ServerExitEvent {
		const interrupted = exit.interrupted === true;
		const { label, file } = this.target.config;
		const failure =
			exit.error !== undefined
				? errorDiagnostic(
						"serve.serverExited",
						{ resource: file },
						`Rojo couldn't start to serve ${label}: ${exit.error.message}`
					)
				: !interrupted && exit.code !== 0
					? errorDiagnostic(
							"serve.serverExited",
							{ resource: file },
							`Rojo stopped serving ${label} with ${exit.code === null ? `signal ${exit.signal}` : `exit code ${exitCodeText(exit.code)}`}${said ? "; see what it said above." : ", without saying why."}`
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
