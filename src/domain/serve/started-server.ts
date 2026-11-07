import path from "path";
import { RunOnceScheduler } from "../../base/async.js";
import { ErrorUtils } from "../../base/errors.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ProcessExit } from "../../platform/process/process-service.js";
import {
	RojoRunner,
	SupervisedExitEvent,
	SupervisedRojoProcess,
	crashedAgain,
	exitHow,
} from "../runner/rojo-runner.js";
import { ServerInfo } from "../runner/rojo-server.js";
import { ServeFlags } from "../runner/serve-flags.js";
import {
	ServePlan,
	ServeTarget,
	ServerConnectionEvent,
	ServerOutputEvent,
	ServerExitEvent,
	ServerReadyEvent,
	ServerRestartEvent,
} from "./serve-service.js";
import { PortState, ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-records.js";

const READY_POLL_MS = { first: 200, max: 1_000 };

const SLOW_START_MS = 10_000;

interface StartedServerListener {
	served(serving: ServerReadyEvent): void;
	/** Rojo crashed, and the one started in its place serves. */
	restarted(serving: ServerRestartEvent): void;
	said(said: ServerOutputEvent): void;
	stopped(stop: ServerExitEvent): void;
	connection(change: ServerConnectionEvent): void;
	failed(error: Error): void;
}

/** A server the session started to serve a config with. */
export class StartedServer extends AbstractDisposable {
	private _target: ServeTarget;
	/** The project name the server last answered with, which a running Rojo keeps when its project file renames it. */
	private servedProject: string;
	private readonly child: SupervisedRojoProcess;
	private exited = false;
	private restartedAfter: ProcessExit | undefined;
	private stoppedOnPurpose = false;
	private recordWrite: Promise<void> | undefined;
	/** The server its record was last written for. */
	private recorded: ServerInfo | undefined;
	/** What the current Rojo was taken to serve. */
	private serving: ServerInfo | undefined;
	/** The sessions its Rojos were taken to serve, which no later one of them can serve again. */
	private readonly sessions = new Set<string>();
	/** Counts the Rojos started, so an answer to an earlier one's probe isn't taken for the current one's. */
	private generation = 0;
	private connected = 0;
	private readonly ready: RunOnceScheduler;
	private readyDelay = READY_POLL_MS.first;
	private startedAt = Date.now();
	private toldSlow = false;

	constructor(
		target: ServeTarget,
		plan: ServePlan,
		private readonly rojoRunner: RojoRunner,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly listener: StartedServerListener,
		/** Runs before Rojo starts again after a crash, to write the project file afresh. */
		beforeRestart?: () => Promise<void>
	) {
		super();
		this._target = target;
		this.servedProject = target.project;
		const { executable, serverArgs, selection } = plan;
		this.child = this._register(
			rojoRunner.supervise(
				() =>
					rojoRunner.start(
						executable,
						"serve",
						path.relative(
							selection.home,
							target.config.projectFile
						),
						ServeFlags.portIn(serverArgs).unwrapOr(undefined) ===
							undefined
							? [
									...serverArgs,
									"--port",
									String(target.address.port),
								]
							: serverArgs,
						selection.home
					),
				{ beforeRestart, confirmServed: () => this.servedUntilExit() }
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
					target: this.target,
					opened,
					clients: this.connected,
				});
			})
		);
		this._register(
			this.child.onDidMessage((message) => {
				if (message.severity !== "debug") said = true;
				this.listener.said({ target: this.target, message });
			})
		);
		this._register(
			this.child.onDidRestart(({ exit }) => {
				said = false;
				this.generation++;
				this.serving = undefined;
				this.restartedAfter = exit;
				this.toldSlow = false;
				this.startedAt = Date.now();
				this.readyDelay = READY_POLL_MS.first;
				if (this.connected > 0) {
					this.connected = 0;
					this.listener.connection({
						target: this.target,
						opened: false,
						clients: 0,
					});
				}
				this.ready.schedule(READY_POLL_MS.first);
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

	get target(): ServeTarget {
		return this._target;
	}

	/** Whether a Rojo it started has answered for its project. */
	get hasServed(): boolean {
		return this.recordWrite !== undefined;
	}

	/** Takes the target its config gives now, at the same address, such as one with a new project name. */
	follow(target: ServeTarget): void {
		this._target = target;
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
		this.recorded = info;
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
		const { recordWrite, recorded } = this;
		if (!recordWrite || !recorded) return;
		await recordWrite;
		await this.records
			.remove(this.target.address, recorded)
			.catch(() => undefined);
	}

	/** Whether the Rojo that just crashed served what it was taken to: not when that server still answers, so it was another's all along, whose record it then leaves. */
	private async servedUntilExit(): Promise<boolean> {
		const taken = this.serving;
		if (taken?.session === undefined) return true;
		const state = await this.probe.probe(this.target.address);
		if (state.kind !== "serving" || state.info.session !== taken.session)
			return true;
		await this.unrecord();
		this.recordWrite = undefined;
		this.serving = undefined;
		return false;
	}

	/** Whether the server that answered can be the current Rojo's: not one an earlier Rojo of it served, nor one recorded for another Rojo that still runs. */
	private async mayServe(info: ServerInfo): Promise<boolean> {
		const { target } = this;
		if (
			info.project !== target.project &&
			info.project !== this.servedProject
		)
			return false;
		if (info.session === undefined) return true;
		if (this.sessions.has(info.session)) return false;
		const pid = (await this.records.recordOf(target.address, info))?.pid;
		return (
			pid === undefined ||
			pid === this.child.pid ||
			!this.rojoRunner.isRunning(pid)
		);
	}

	private askReady(): void {
		const { target, generation } = this;
		const current = () =>
			!this.stoppedOnPurpose &&
			!this.exited &&
			generation === this.generation;
		this.probe
			.probe(target.address)
			.then(async (state) => {
				if (!current()) return;
				const info =
					state.kind === "serving" &&
					(await this.mayServe(state.info))
						? state.info
						: undefined;
				if (!current()) return;
				if (info) {
					if (!this.child.markReady()) return;
					this.servedProject = info.project;
					this.serving = info;
					if (info.session !== undefined)
						this.sessions.add(info.session);
					const crashed = this.restartedAfter;
					this.restartedAfter = undefined;
					// Recorded before it is announced, so a serve killed right after still leaves its server's record.
					this.recordWrite = this.writeRecord(info);
					return this.recordWrite.then(() => {
						if (this.stoppedOnPurpose || this.exited) return;
						const serving = { target, info };
						if (crashed)
							this.listener.restarted({
								...serving,
								exit: crashed,
							});
						else this.listener.served(serving);
					});
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

	private stopOf(
		{ exit, gaveUp }: SupervisedExitEvent,
		said: boolean
	): ServerExitEvent {
		const { target } = this;
		const { label, file } = target.config;
		if (gaveUp)
			return {
				kind: "crashed",
				target,
				exit,
				failure: crashedAgain(`serving ${label}`, file, exit, gaveUp),
			};
		if (exit.error !== undefined)
			return {
				kind: "failed",
				target,
				exit,
				failure: errorDiagnostic(
					"serve.serverExited",
					{ resource: file },
					`Rojo couldn't start to serve ${label}: ${exit.error.message}`
				),
			};
		if (exit.interrupted === true)
			return { kind: "interrupted", target, exit };
		if (exit.code === 0) return { kind: "stopped", target, exit };
		return {
			kind: "failed",
			target,
			exit,
			failure: errorDiagnostic(
				"serve.serverExited",
				{ resource: file },
				`Rojo stopped serving ${label} with ${exitHow(exit)}${said ? "; see what it said above." : ", without saying why."}`
			),
		};
	}
}
