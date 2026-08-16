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
