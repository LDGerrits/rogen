export interface Task<T> {
	(): T;
}

/**
 * A queue that handles one promise at a time.
 */
export class Sequencer {
	private current: Promise<unknown> = Promise.resolve(null);

	queue<T>(promiseTask: Task<Promise<T>>): Promise<T> {
		return (this.current = this.current.then(
			() => promiseTask(),
			() => promiseTask()
		));
	}
}

/**
 * Creates a promise whose resolution or rejection can be controlled imperatively.
 */
export class DeferredPromise<T> {
	private completeCallback!: (value: T | Promise<T>) => void;
	private errorCallback!: (err: unknown) => void;

	private _isResolved = false;
	private _isRejected = false;

	public readonly p: Promise<T>;

	constructor() {
		this.p = new Promise<T>((c, e) => {
			this.completeCallback = c;
			this.errorCallback = e;
		});
	}

	public get isSettled(): boolean {
		return this._isResolved || this._isRejected;
	}

	public complete(value: T): void {
		if (this.isSettled) return;
		this._isResolved = true;
		this.completeCallback(value);
	}

	public error(err: unknown): void {
		if (this.isSettled) return;
		this._isRejected = true;
		this.errorCallback(err);
	}
}
