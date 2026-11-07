import {
	AbstractDisposable,
	DisposableStore,
	toDisposable,
} from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
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
	private readonly handlers = this._register(new DisposableStore());
	private listeners = 0;
	private shuttingDown = false;
	/** Whether the signals are Rogen's: while something listens, and after a shutdown until the children have stopped. */
	private handling = false;
	signal: NodeJS.Signals | undefined;

	constructor(
		/** Ends at once what a graceful shutdown would still be waiting on, before a second signal exits. */
		private readonly stopNow: () => void = () => undefined,
		/** Settles once no child is left running. */
		private readonly stopped: () => Promise<void> = () => Promise.resolve()
	) {
		super();
	}

	/** Takes over the signals while something listens, so a run that doesn't listen still dies of them. */
	readonly onWillShutdown: Event<void> = (listener, disposables) => {
		if (this.listeners++ === 0 && !this.handling) this.listenForSignals();
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
		const shutDown = this.shuttingDown;
		this.shuttingDown = false;
		if (!shutDown) return this.stopListening();
		this.stopped()
			.then(() => {
				if (this.listeners === 0) this.stopListening();
			})
			.catch(() => undefined);
	}

	private stopListening(): void {
		this.handling = false;
		this.handlers.clear();
	}

	private shutdown(): void {
		if (this.shuttingDown || this.listeners === 0) return;
		this.shuttingDown = true;
		this._onWillShutdown.fire();
	}

	private listenForSignals(): void {
		this.handling = true;
		for (const signal of SHUTDOWN_SIGNALS) {
			const listener = () => {
				if (this.shuttingDown || this.listeners === 0)
					return this.exitNow(signal);
				this.signal ??= signal;
				this.shutdown();
			};
			process.on(signal, listener);
			this.handlers.add(
				toDisposable(() => process.off(signal, listener))
			);
		}
		this.listenForClosedOutput();
	}

	/** A second signal, a common reflex, means the graceful stop is taking too long. */
	private exitNow(signal: NodeJS.Signals): void {
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
		this.handlers.add(
			toDisposable(() => process.stdout.off("error", listener))
		);
	}
}
