import { DisposableStore } from "./disposable.js";

export interface Event<T> {
	(listener: (e: T) => void, disposables?: DisposableStore): Disposable;
}

export class Emitter<T> implements Disposable {
	private listeners = new Set<(e: T) => void>();

	get event(): Event<T> {
		return (listener: (e: T) => void, disposables?: DisposableStore) => {
			this.listeners.add(listener);

			const disposable = {
				[Symbol.dispose]: () => {
					this.listeners.delete(listener);
				},
			};

			if (disposables) {
				disposables.add(disposable);
			}

			return disposable;
		};
	}

	fire(event: T): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	[Symbol.dispose](): void {
		this.listeners.clear();
	}
}
