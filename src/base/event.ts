import {
	Disposable,
	DisposableStore,
	NullDisposable,
	toDisposable,
} from "./disposable.js";
import { onUnexpectedError } from "./errors.js";

export interface Event<T> {
	(listener: (e: T) => void, disposables?: DisposableStore): Disposable;
}

/** An event that never fires. */
export const NullEvent: Event<never> = () => NullDisposable;

type Listener<T> = (e: T) => void;

/** One subscription, so a function that subscribes twice is told twice and is dropped once for each. */
interface Subscription<T> {
	readonly listener: Listener<T>;
}

export class Emitter<T> implements Disposable {
	private readonly _listeners = new Set<Subscription<T>>();
	private _disposed = false;
	private _event?: Event<T>;

	get event(): Event<T> {
		this._event ??= (
			listener: Listener<T>,
			disposables?: DisposableStore
		) => {
			if (this._disposed) return NullDisposable;

			const subscription: Subscription<T> = { listener };
			this._listeners.add(subscription);

			const disposable = toDisposable(() => {
				this._listeners.delete(subscription);
			});

			if (disposables) {
				disposables.add(disposable);
			}

			return disposable;
		};

		return this._event;
	}

	fire(event: T): void {
		if (this._disposed) return;

		for (const subscription of [...this._listeners]) {
			if (!this._listeners.has(subscription)) continue;
			try {
				const result = subscription.listener(event) as unknown;
				if (result instanceof Promise) {
					result.catch((rejection) => {
						onUnexpectedError(
							new Error(
								"Unhandled promise rejection in event listener",
								{ cause: rejection }
							)
						);
					});
				}
			} catch (error) {
				onUnexpectedError(
					new Error("Error in event listener", { cause: error })
				);
			}
		}
	}

	[Symbol.dispose](): void {
		if (!this._disposed) {
			this._disposed = true;
			this._listeners.clear();
		}
	}
}
