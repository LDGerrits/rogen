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
	restarted(serving: ServerRestartEvent): void;
	said(said: ServerOutputEvent): void;
	stopped(stop: ServerExitEvent): void;
	connection(change: ServerConnectionEvent): void;
	failed(error: Error): void;
}

export class StartedServer extends AbstractDisposable {
	private _target: ServeTarget;
	private servedProject: string;
	private readonly child: SupervisedRojoProcess;
	private exited = false;
	private stoppedOnPurpose = false;
	private record: { info: ServerInfo; written: Promise<void> } | undefined;
	private readonly sessions = new Set<string>();
	private generation = new Generation();
	private readonly ready: RunOnceScheduler;

	constructor(
		target: ServeTarget,
		plan: ServePlan,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly listener: StartedServerListener,
		beforeRestart: (() => Promise<void>) | undefined,
		@RojoRunner private readonly rojoRunner: RojoRunner
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
		this._register(
			this.child.onDidConnection((change) => {
				if (this.stoppedOnPurpose || this.exited) return;
				const opened = change === "opened";
				const { generation } = this;
				generation.connected = Math.max(
					0,
					generation.connected + (opened ? 1 : -1)
				);
				this.listener.connection({
					target: this.target,
					opened,
					clients: generation.connected,
				});
			})
		);
		this._register(
			this.child.onDidMessage((message) => {
				if (message.severity !== "debug") this.generation.said = true;
				this.listener.said({ target: this.target, message });
			})
		);
		this._register(
			this.child.onDidRestart(({ exit }) => {
				const { connected } = this.generation;
				this.generation = new Generation(exit);
				if (connected > 0) {
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
					this.listener.stopped(
						this.stopOf(exit, this.generation.said)
					);
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

	get hasServed(): boolean {
		return this.record !== undefined;
	}

	follow(target: ServeTarget): void {
		this._target = target;
	}

	async terminate(): Promise<void> {
		this.stoppedOnPurpose = true;
		this.ready.cancel();
		await this.child.terminate();
	}

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
		const { record } = this;
		if (!record) return;
		await record.written;
		await this.records.remove(this.target.address, record.info);
	}

	private async servedUntilExit(): Promise<boolean> {
		const taken = this.generation.serving;
		if (taken?.session === undefined) return true;
		const state = await this.probe.probe(this.target.address);
		if (state.kind !== "serving" || state.info.session !== taken.session)
			return true;
		await this.unrecord();
		this.record = undefined;
		this.generation.serving = undefined;
		return false;
	}

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
					generation.serving = info;
					if (info.session !== undefined)
						this.sessions.add(info.session);
					const crashed = generation.restartedAfter;
					generation.restartedAfter = undefined;
					this.record = { info, written: this.writeRecord(info) };
					return this.record.written.then(() => {
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
				this.warnWhenSlow(generation, state);
				generation.readyDelay = Math.min(
					generation.readyDelay * 2,
					READY_POLL_MS.max
				);
				this.ready.schedule(generation.readyDelay);
			})
			.catch((error) =>
				this.listener.failed(ErrorUtils.fromUnknown(error))
			);
	}

	private warnWhenSlow(generation: Generation, state: PortState): void {
		if (
			generation.toldSlow ||
			Date.now() - generation.startedAt < SLOW_START_MS
		)
			return;
		generation.toldSlow = true;
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
		const failed = (message: string): ServerExitEvent => ({
			kind: "failed",
			target,
			exit,
			failure: errorDiagnostic(
				"serve.serverExited",
				{ resource: file },
				message
			),
		});
		if (exit.error !== undefined)
			return failed(
				`Rojo couldn't start to serve ${label}: ${exit.error.message}`
			);
		if (exit.interrupted === true)
			return { kind: "interrupted", target, exit };
		if (exit.code === 0) return { kind: "stopped", target, exit };
		return failed(
			`Rojo stopped serving ${label} with ${exitHow(exit)}${said ? "; see what it said above." : ", without saying why."}`
		);
	}
}

class Generation {
	said = false;
	connected = 0;
	readyDelay = READY_POLL_MS.first;
	toldSlow = false;
	readonly startedAt = Date.now();
	serving: ServerInfo | undefined;

	constructor(public restartedAfter?: ProcessExit) {}
}
