import { AbstractDisposable } from "../../base/disposable.js";
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
			this._register({
				[Symbol.dispose]: () => process.off(signal, listener),
			});
		}
	}
}
