import { timeout } from "../../base/async.js";
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

const RESTART_DELAY_MS = { first: 500, max: 10_000 };

const SERVED_LONG_MS = 10_000;

export class SupervisedRojo
	extends AbstractDisposable
	implements SupervisedRojoProcess
{
	private readonly _onDidMessage = this._register(
		new Emitter<ServerMessage>()
	);
	readonly onDidMessage: Event<ServerMessage> = this._onDidMessage.event;

	private readonly _onDidConnection = this._register(
		new Emitter<"opened" | "closed">()
	);
	readonly onDidConnection: Event<"opened" | "closed"> =
		this._onDidConnection.event;

	private readonly _onDidRestart = this._register(
		new Emitter<RojoRestartEvent>()
	);
	readonly onDidRestart: Event<RojoRestartEvent> = this._onDidRestart.event;

	private readonly _onDidExit = this._register(
		new Emitter<SupervisedExitEvent>()
	);
	readonly onDidExit: Event<SupervisedExitEvent> = this._onDidExit.event;

	private current: RojoProcess | undefined;
	private readonly running = this._register(new DisposableStore());
	private restarted = false;
	private ready = false;
	private exited = false;
	private stopping = false;
	private readonly halted = new AbortController();
	private restarting: Promise<void> | undefined;
	private readyAt = 0;
	private restartDelay = 0;

	constructor(
		private readonly start: () => RojoProcess,
		private readonly options: SupervisedRojoOptions = {}
	) {
		super();
		this.launch();
	}

	get pid(): number | undefined {
		return this.current?.pid;
	}

	markReady(): boolean {
		if (this.exited) return false;
		this.ready = true;
		this.readyAt = Date.now();
		return true;
	}

	async terminate(): Promise<void> {
		this.stopping = true;
		this.halted.abort();
		await this.restarting;
		await this.current?.terminate();
	}

	override [Symbol.dispose](): void {
		this.stopping = true;
		this.halted.abort();
		super[Symbol.dispose]();
	}

	private launch(): void {
		this.running.clear();
		const child = this.running.add(this.start());
		this.current = child;
		this.ready = false;
		this.exited = false;
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
				this.ended(exit, crash.length > 0 ? crash : errors)
			)
		);
	}

	private ended(exit: ProcessExit, lines: readonly string[]): void {
		this.exited = true;
		const crashed =
			!this.stopping &&
			exit.error === undefined &&
			exit.interrupted !== true &&
			exit.code !== null &&
			exit.code !== 0;
		if (!crashed) {
			this._onDidExit.fire({ exit });
			return;
		}
		if (!this.ready) {
			this.endedUnserved(exit, lines);
			return;
		}
		this.restarting = this.restart(exit, lines).catch((error: unknown) => {
			onUnexpectedError(error);
			this._onDidExit.fire({ exit });
		});
	}

	private endedUnserved(exit: ProcessExit, lines: readonly string[]): void {
		this._onDidExit.fire(
			this.restarted ? { exit, gaveUp: lines } : { exit }
		);
	}

	private async restart(
		exit: ProcessExit,
		lines: readonly string[]
	): Promise<void> {
		const served = (await this.options.confirmServed?.()) ?? true;
		if (!served && !this.stopping) {
			this.endedUnserved(exit, lines);
			return;
		}
		await timeout(this.nextRestartDelay(), this.halted.signal);
		if (!this.stopping) await this.options.beforeRestart?.();
		if (this.stopping) {
			this._onDidExit.fire({ exit });
			return;
		}
		this.restarted = true;
		this.launch();
		this._onDidRestart.fire({ exit, lines });
	}

	private nextRestartDelay(): number {
		if (Date.now() - this.readyAt >= SERVED_LONG_MS) this.restartDelay = 0;
		const delay = this.restartDelay;
		this.restartDelay =
			delay === 0
				? RESTART_DELAY_MS.first
				: Math.min(delay * 2, RESTART_DELAY_MS.max);
		return delay;
	}
}
