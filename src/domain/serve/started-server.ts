import path from "path";
import { RunOnceScheduler } from "../../base/async.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	ProcessExit,
	exitCodeText,
} from "../../platform/process/process-service.js";
import { RojoProcess, RojoRunner } from "../runner/rojo-runner.js";
import { ServerInfo } from "../runner/sync-server.js";
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

/** A server the session serves a config with, started by it or adopted. */
export interface RunningServer {
	readonly target: ServeTarget;
	/** Ends what the session holds of it: its process if it started one, else only its watching. */
	terminate(): Promise<void>;
	/** Terminates it and drops its record and everything it holds. */
	retire(): Promise<void>;
	unrecord(): Promise<void>;
	[Symbol.dispose](): void;
}

export class StartedServer extends AbstractDisposable implements RunningServer {
	private readonly child: RojoProcess;
	private exited = false;
	private ending = false;
	private record: Promise<void> | undefined;
	private answering: ServerInfo | undefined;
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
				serverArgs,
				selection.home
			)
		);
		let said = false;
		this._register(
			this.child.onDidConnection((change) => {
				if (this.ending || this.exited) return;
				const opened = change === "opened";
				this.connected = Math.max(
					0,
					this.connected + (opened ? 1 : -1)
				);
				this.updateRecord().catch(onUnexpectedError);
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
				if (!this.ending)
					this.listener.stopped(this.stopOf(exit, said));
			})
		);
		this.ready = this._register(
			new RunOnceScheduler(() => this.askReady(), READY_POLL_MS.first)
		);
		this.ready.schedule();
	}

	async terminate(): Promise<void> {
		this.ending = true;
		this.ready.cancel();
		await this.child.terminate();
	}

	async retire(): Promise<void> {
		await this.terminate();
		await this.unrecord();
		this[Symbol.dispose]();
	}

	private updateRecord(): Promise<void> {
		if (!this.record || !this.answering || this.ending || this.exited)
			return Promise.resolve();
		const info = this.answering;
		this.record = this.record.then(() =>
			this.ending || this.exited ? undefined : this.writeRecord(info)
		);
		return this.record;
	}

	private writeRecord(info: ServerInfo): Promise<void> {
		const { target } = this;
		return this.records
			.write(target.address, info, {
				projectFile: target.config.projectFile,
				clients: info.server.reportsConnections(info.version)
					? this.connected
					: undefined,
			})
			.catch((error) =>
				this.listener.failed(ErrorUtils.fromUnknown(error))
			);
	}

	async unrecord(): Promise<void> {
		if (!this.record) return;
		await this.record;
		await this.records.remove(this.target.address).catch(() => undefined);
	}

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
