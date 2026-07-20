export interface Event<T> {
	(listener: (e: T) => void): Disposable;
}

export class Emitter<T> implements Disposable {
	private listeners = new Set<(e: T) => void>();

	get event(): Event<T> {
		return (listener: (e: T) => void) => {
			this.listeners.add(listener);
			return {
				[Symbol.dispose]: () => {
					this.listeners.delete(listener);
				},
			};
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
