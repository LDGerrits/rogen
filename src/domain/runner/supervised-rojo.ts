import { AbstractDisposable, DisposableStore } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { onUnexpectedError } from "../../base/errors.js";
import { ProcessExit } from "../../platform/process/process-service.js";
import {
	RojoProcess,
	RojoRestartEvent,
	SupervisedExitEvent,
	SupervisedRojoOptions,
	SupervisedRojoProcess,
} from "./rojo-runner.js";
import { RojoServer, ServerMessage } from "./rojo-server.js";

/** How long a restarted Rojo must run before its next crash counts as a new one rather than the same one again. */
const BACK_TO_BACK_MS = 30_000;

export class SupervisedRojo
	extends AbstractDisposable
	implements SupervisedRojoProcess
{
	private readonly _onDidMessage = this._register(
		new Emitter<ServerMessage>()
	);
	/** What the current Rojo says; the lines of a crash come as `debug`. */
	readonly onDidMessage: Event<ServerMessage> = this._onDidMessage.event;

	private readonly _onDidConnection = this._register(
		new Emitter<"opened" | "closed">()
	);
	readonly onDidConnection: Event<"opened" | "closed"> =
		this._onDidConnection.event;

	private readonly _onDidRestart = this._register(
		new Emitter<RojoRestartEvent>()
	);
	/** Fired once the Rojo that replaces a crashed one has started. */
	readonly onDidRestart: Event<RojoRestartEvent> = this._onDidRestart.event;

	private readonly _onDidExit = this._register(
		new Emitter<SupervisedExitEvent>()
	);
	/** Fired once, when a Rojo stops and none is started in its place. */
	readonly onDidExit: Event<SupervisedExitEvent> = this._onDidExit.event;

	private current: RojoProcess | undefined;
	private readonly running = this._register(new DisposableStore());
	private restarted = false;
	private ready = false;
	private startedAt = 0;
	private stopping = false;
	private restarting: Promise<void> | undefined;

	constructor(
		private readonly start: () => RojoProcess,
		private readonly options: SupervisedRojoOptions = {}
	) {
		super();
		this.launch();
	}

	/** The id of the current Rojo's process. */
	get pid(): number | undefined {
		return this.current?.pid;
	}

	/** Marks the current Rojo as serving, so a crash from now on is one to restart from. */
	markReady(): void {
		this.ready = true;
	}

	/** Ends the current Rojo, and starts no other. */
	async terminate(): Promise<void> {
		this.stopping = true;
		await this.restarting;
		await this.current?.terminate();
	}

	override [Symbol.dispose](): void {
		this.stopping = true;
		super[Symbol.dispose]();
	}

	private launch(): void {
		this.running.clear();
		const child = this.running.add(this.start());
		this.current = child;
		this.ready = false;
		this.startedAt = Date.now();
		const errors: string[] = [];
		const crash: string[] = [];
		this.running.add(
			child.onDidMessage((message) => {
				const lines = [message.text, ...(message.details ?? [])];
				if (crash.length > 0 || RojoServer.isCrash(message.text)) {
					if (message.severity === "error") crash.push(...lines);
					this._onDidMessage.fire({ ...message, severity: "debug" });
					return;
				}
				if (message.severity === "error") errors.push(...lines);
				this._onDidMessage.fire(message);
			})
		);
		this.running.add(
			child.onDidConnection((change) =>
				this._onDidConnection.fire(change)
			)
		);
		this.running.add(
			child.onDidExit((exit) =>
				this.exited(exit, crash.length > 0 ? crash : errors)
			)
		);
	}

	private exited(exit: ProcessExit, lines: readonly string[]): void {
		const crashed =
			!this.stopping &&
			exit.error === undefined &&
			exit.interrupted !== true &&
			exit.code !== null &&
			exit.code !== 0;
		if (!crashed || (!this.restarted && !this.ready)) {
			this._onDidExit.fire({ exit });
			return;
		}
		if (
			this.restarted &&
			(!this.ready || Date.now() - this.startedAt < BACK_TO_BACK_MS)
		) {
			this._onDidExit.fire({ exit, gaveUp: lines });
			return;
		}
		this.restarting = this.restart(exit, lines).catch(onUnexpectedError);
	}

	private async restart(
		exit: ProcessExit,
		lines: readonly string[]
	): Promise<void> {
		await this.options.beforeRestart?.();
		if (this.stopping) {
			this._onDidExit.fire({ exit });
			return;
		}
		this.restarted = true;
		this.launch();
		this._onDidRestart.fire({ exit, lines });
	}
}
