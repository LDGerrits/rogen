import {
	AbstractDisposable,
	DisposableStore,
	toDisposable,
} from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { ProcessService } from "../process/process-service.js";
import { LifecycleService, exitCodeOfSignal } from "./lifecycle-service.js";

const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = [
	"SIGINT",
	"SIGTERM",
	"SIGHUP",
];

export class NativeLifecycleService
	extends AbstractDisposable
	implements LifecycleService
{
	declare readonly _serviceBrand: undefined;

	private readonly _onWillShutdown = this._register(new Emitter<void>());
	private readonly signalHandlers = this._register(new DisposableStore());
	private readonly outputHandlers = this._register(new DisposableStore());
	private listeners = 0;
	private shuttingDown = false;
	private draining = false;
	private childrenRunning = false;
	private handlingSignals = false;
	private handlingOutput = false;
	signal: NodeJS.Signals | undefined;

	/**
	 * A signal that ends Rogen then ends the children too, which the terminal's
	 * signal misses in their own process groups; a second signal ends them at
	 * once, before it exits.
	 */
	constructor(
		@ProcessService private readonly processService: ProcessService
	) {
		super();
		this._register(
			processService.onDidChangeRunning((running) => {
				this.childrenRunning = running;
				if (!running) this.draining = false;
				this.update();
			})
		);
	}

	readonly onWillShutdown: Event<void> = (listener, disposables) => {
		this.listeners++;
		this.update();
		const subscription = this._onWillShutdown.event(listener);
		const disposable = toDisposable(() => {
			subscription[Symbol.dispose]();
			if (--this.listeners === 0) this.lastLeft();
		});
		disposables?.add(disposable);
		return disposable;
	};

	private lastLeft(): void {
		const shutDown = this.shuttingDown;
		this.shuttingDown = false;
		if (shutDown) this.draining = this.childrenRunning;
		this.update();
	}

	private get hasListeners(): boolean {
		return this.listeners > 0;
	}

	private get holdsClosedOutput(): boolean {
		return this.hasListeners || this.draining;
	}

	private get holdsSignals(): boolean {
		return this.holdsClosedOutput || this.childrenRunning;
	}

	private update(): void {
		const output = this.holdsClosedOutput;
		const signals = this.holdsSignals;
		if (output !== this.handlingOutput) {
			this.handlingOutput = output;
			if (output) this.listenForClosedOutput();
			else this.outputHandlers.clear();
		}
		if (signals !== this.handlingSignals) {
			this.handlingSignals = signals;
			if (signals) this.listenForSignals();
			else this.signalHandlers.clear();
		}
	}

	private shutdown(): void {
		if (this.shuttingDown || !this.hasListeners) return;
		this.shuttingDown = true;
		this._onWillShutdown.fire();
	}

	private listenForSignals(): void {
		for (const signal of SHUTDOWN_SIGNALS) {
			const listener = () => {
				if (this.shuttingDown) return this.exitNow(signal);
				if (!this.hasListeners)
					return this.draining
						? this.exitNow(signal)
						: this.exitWithChildren(signal);
				this.signal ??= signal;
				this.shutdown();
			};
			process.on(signal, listener);
			this.signalHandlers.add(
				toDisposable(() => process.off(signal, listener))
			);
		}
	}

	private exitWithChildren(signal: NodeJS.Signals): void {
		this.processService.killAll();
		process.exit(exitCodeOfSignal(signal));
	}

	private exitNow(signal: NodeJS.Signals): void {
		this.processService.killAll();
		process.stderr.write("Stopping now\n");
		process.exit(exitCodeOfSignal(signal));
	}

	/**
	 * A reader that quits, as `head -1` does, is a request to stop; its
	 * leftover write would crash the process.
	 */
	private listenForClosedOutput(): void {
		const listener = (error: NodeJS.ErrnoException) => {
			if (error.code !== "EPIPE") throw error;
			this.shutdown();
		};
		process.stdout.on("error", listener);
		this.outputHandlers.add(
			toDisposable(() => process.stdout.off("error", listener))
		);
	}
}
