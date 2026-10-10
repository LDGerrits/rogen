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

		const failures: unknown[] = [];
		for (const disposable of this.disposables) {
			try {
				disposable[Symbol.dispose]();
			} catch (error) {
				failures.push(error);
			}
		}
		this.disposables.clear();
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1)
			throw new AggregateError(failures, "Several disposables failed.");
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
