export interface Disposable {
	[Symbol.dispose](): void;
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

	[Symbol.dispose](): void {
		if (this.isDisposed) return;
		this.isDisposed = true;

		for (const disposable of this.disposables) {
			disposable[Symbol.dispose]();
		}
		this.disposables.clear();
	}
}

/**
 * Abstract base class for a disposable object.
 *
 * Subclasses can `_register` disposables that will be automatically
 * cleaned up when this object is disposed of.
 */
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
