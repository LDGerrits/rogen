import { AbstractDisposable, toDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { LifecycleService } from "./lifecycle-service.js";

const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export class NativeLifecycleService
	extends AbstractDisposable
	implements LifecycleService
{
	declare readonly _serviceBrand: undefined;

	private readonly _onWillShutdown = this._register(new Emitter<void>());
	private listening = false;

	/** Takes over the signals once something listens, so a run that never listens still dies of them. */
	readonly onWillShutdown: Event<void> = (listener, disposables) => {
		this.listenForSignals();
		return this._onWillShutdown.event(listener, disposables);
	};

	private listenForSignals(): void {
		if (this.listening) return;
		this.listening = true;
		// `once`, so a second signal falls through to the default and kills a stuck process.
		const listener = () => this._onWillShutdown.fire();
		for (const signal of SHUTDOWN_SIGNALS) {
			process.once(signal, listener);
			this._register(toDisposable(() => process.off(signal, listener)));
		}
		this.listenForClosedOutput();
	}

	/** A reader that quits, as `head -1` does, is a request to stop; the write it leaves behind would otherwise crash the process with the servers it started running. */
	private listenForClosedOutput(): void {
		let closed = false;
		const listener = (error: NodeJS.ErrnoException) => {
			if (error.code !== "EPIPE") throw error;
			if (closed) return;
			closed = true;
			this._onWillShutdown.fire();
		};
		process.stdout.on("error", listener);
		this._register(
			toDisposable(() => process.stdout.off("error", listener))
		);
	}
}
