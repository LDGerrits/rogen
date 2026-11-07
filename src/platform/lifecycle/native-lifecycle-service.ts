import {
	AbstractDisposable,
	DisposableStore,
	toDisposable,
} from "../../base/disposable.js";
import { Emitter, Event, NullEvent } from "../../base/event.js";
import { LifecycleService, exitCodeOfSignal } from "./lifecycle-service.js";

const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = [
	"SIGINT",
	"SIGTERM",
	"SIGHUP",
];

/** Where a shutdown stands: `shuttingDown` once listeners were told, `draining` once they left and the children stop, `forwarding` once a signal nothing listened for went on to the children, `exiting` once Rogen exits. */
type Phase = "idle" | "shuttingDown" | "draining" | "forwarding" | "exiting";

/** Settles once what `stream` holds has been written, so an exit doesn't drop it. */
const flushed = (stream: NodeJS.WriteStream) =>
	new Promise<void>((resolve) => stream.write("", () => resolve()));

export class NativeLifecycleService
	extends AbstractDisposable
	implements LifecycleService
{
	declare readonly _serviceBrand: undefined;

	private readonly _onWillShutdown = this._register(new Emitter<void>());
	private readonly signalHandlers = this._register(new DisposableStore());
	private readonly outputHandlers = this._register(new DisposableStore());
	private listeners = 0;
	private phase: Phase = "idle";
	private childrenRunning = false;
	private handlingSignals = false;
	private handlingOutput = false;
	signal: NodeJS.Signals | undefined;

	constructor(
		/** Ends at once what a graceful shutdown would still be waiting on, before a second signal exits. */
		private readonly stopNow: () => void = () => undefined,
		/** Settles once no child is left running. */
		private readonly stopped: () => Promise<void> = () => Promise.resolve(),
		/** Whether a child is running; a signal that ends Rogen then ends the children too, which the terminal's signal misses in their own process groups. */
		onDidChangeRunning: Event<boolean> = NullEvent,
		/** Sends the signal to every running child, which ends it after a grace period if it hasn't stopped. */
		private readonly forward: (signal: NodeJS.Signals) => void = () =>
			undefined
	) {
		super();
		this._register(
			onDidChangeRunning((running) => {
				this.childrenRunning = running;
				this.update();
			})
		);
	}

	/** Takes over the signals while something listens, so a run that doesn't listen still dies of them. */
	readonly onWillShutdown: Event<void> = (listener, disposables) => {
		this.listeners++;
		this.update();
		const subscription = this._onWillShutdown.event(listener);
		let left = false;
		const disposable = toDisposable(() => {
			if (left) return;
			left = true;
			subscription[Symbol.dispose]();
			if (--this.listeners === 0) this.lastLeft();
		});
		disposables?.add(disposable);
		return disposable;
	};

	/** A later listener starts afresh; after a shutdown, a second signal still ends the children that are stopping. */
	private lastLeft(): void {
		if (this.phase === "shuttingDown") {
			this.phase = "draining";
			this.stopped()
				.then(() => {
					if (this.phase === "draining") this.phase = "idle";
					this.update();
				})
				.catch(() => undefined);
		}
		this.update();
	}

	/** Holds the signals while something listens, a shutdown drains, a child runs or a signal went on to the children, and the closed output only for the first two. */
	private update(): void {
		const output = this.listeners > 0 || this.phase === "draining";
		const signals =
			output || this.childrenRunning || this.phase === "forwarding";
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
		if (this.phase === "shuttingDown" || this.listeners === 0) return;
		this.phase = "shuttingDown";
		this._onWillShutdown.fire();
	}

	private listenForSignals(): void {
		for (const signal of SHUTDOWN_SIGNALS) {
			const listener = () => {
				if (this.phase !== "idle" && this.phase !== "draining")
					return this.exitNow(signal);
				if (this.listeners === 0)
					return this.phase === "draining"
						? this.exitNow(signal)
						: void this.exitWithChildren(signal);
				this.signal ??= signal;
				this.shutdown();
			};
			process.on(signal, listener);
			this.signalHandlers.add(
				toDisposable(() => process.off(signal, listener))
			);
		}
	}

	/** Gives the children the signal the terminal missed in their own process groups, and exits with its code once they end, as each would alone. */
	private async exitWithChildren(signal: NodeJS.Signals): Promise<void> {
		this.phase = "forwarding";
		this.update();
		this.forward(signal);
		await this.stopped();
		await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
		if (this.phase !== "forwarding") return;
		this.phase = "exiting";
		// A child started since the signal would otherwise outlive Rogen.
		this.stopNow();
		process.exit(exitCodeOfSignal(signal));
	}

	/** A second signal, a common reflex, means the graceful stop is taking too long. */
	private exitNow(signal: NodeJS.Signals): void {
		this.phase = "exiting";
		this.stopNow();
		process.stderr.write("Stopping now\n");
		process.exit(exitCodeOfSignal(signal));
	}

	/** A reader that quits, as `head -1` does, is a request to stop; its leftover write would crash the process. */
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
