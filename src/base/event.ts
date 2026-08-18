import { DisposableStore, Disposable } from "./disposable.js";

export interface Event<T> {
	(listener: (e: T) => void, disposables?: DisposableStore): Disposable;
}

type Listener<T> = (e: T) => void;

export class Emitter<T> implements Disposable {
	private readonly _listeners = new Set<Listener<T>>();
	private _disposed = false;
	private _event?: Event<T>;

	get event(): Event<T> {
		this._event ??= (
			listener: Listener<T>,
			disposables?: DisposableStore
		) => {
			if (this._disposed) return { [Symbol.dispose]: () => {} };

			this._listeners.add(listener);

			const disposable = {
				[Symbol.dispose]: () => {
					this._listeners.delete(listener);
				},
			};

			if (disposables) {
				disposables.add(disposable);
			}

			return disposable;
		};

		return this._event;
	}

	fire(event: T): void {
		if (this._disposed) return;

		for (const listener of this._listeners) {
			try {
				const result = listener(event) as unknown;
				if (result instanceof Promise) {
					result.catch((err) => {
						console.error(
							"Unhandled promise rejection in event listener:",
							err
						);
					});
				}
			} catch (error) {
				console.error("Error in event listener:", error);
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
