import { Disposable } from "./disposable.js";

export interface Task<T> {
	(): T;
}

/** A queue that handles one promise at a time. */
export class Sequencer {
	private current: Promise<unknown> = Promise.resolve(null);

	queue<T>(promiseTask: Task<Promise<T>>): Promise<T> {
		return (this.current = this.current.then(
			() => promiseTask(),
			() => promiseTask()
		));
	}
}

/** A promise whose resolution or rejection is controlled from outside. */
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

/** Runs `runner` once, `delay` ms after the last `schedule`; disposing it cancels a run that is still waiting. */
export class RunOnceScheduler implements Disposable {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;

	constructor(
		private readonly runner: () => void,
		private readonly delay: number
	) {}

	/** Starts the wait over, for `delay` ms or the scheduler's own. */
	schedule(delay = this.delay): void {
		this.cancel();
		if (this.disposed) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.runner();
		}, delay);
	}

	cancel(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	get isScheduled(): boolean {
		return this.timer !== undefined;
	}

	[Symbol.dispose](): void {
		this.disposed = true;
		this.cancel();
	}
}
