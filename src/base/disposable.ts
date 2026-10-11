export interface Disposable {
	[Symbol.dispose](): void;
}

/** Does nothing when disposed. */
export const NullDisposable: Disposable = Object.freeze({
	[Symbol.dispose]() {},
});

/** A disposable that runs `fn` once, the first time it is disposed. */
export function toDisposable(fn: () => void): Disposable {
	let done = false;
	return {
		[Symbol.dispose]: () => {
			if (done) return;
			done = true;
			fn();
		},
	};
}

export class DisposableStore implements Disposable {
	private readonly disposables = new Set<Disposable>();
	private isDisposed = false;

	add<T extends Disposable>(disposable: T): T {
		if (this.isDisposed) {
			disposable[Symbol.dispose]();
		} else {
			this.disposables.add(disposable);
		}
		return disposable;
	}

	/** Disposes everything added so far; the store stays usable. */
	clear(): void {
		const disposables = [...this.disposables];
		this.disposables.clear();
		const failures: unknown[] = [];
		for (const disposable of disposables) {
			try {
				disposable[Symbol.dispose]();
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1)
			throw new AggregateError(failures, "Several disposables failed.");
	}

	[Symbol.dispose](): void {
		if (this.isDisposed) return;
		this.isDisposed = true;
		this.clear();
	}
}

/** A disposable whose subclasses `_register` what is disposed with it. */
export abstract class AbstractDisposable implements Disposable {
	protected readonly _store = new DisposableStore();

	[Symbol.dispose](): void {
		this._store[Symbol.dispose]();
	}

	protected _register<T extends Disposable>(o: T): T {
		if ((o as unknown as AbstractDisposable) === this) {
			throw new Error("Cannot register a disposable on itself!");
		}
		return this._store.add(o);
	}
}
