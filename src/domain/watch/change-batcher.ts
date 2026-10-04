import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import {
	FileChange,
	normalizeFileChanges,
} from "../../platform/fs/file-changes.js";

/** Changes that came too fast to follow, so the batcher dropped them. */
export interface ChangeBurst {
	readonly dropped: number;
	/** How many it follows before it gives up. */
	readonly threshold: number;
}

export interface ChangeBatcherOptions {
	readonly burstThreshold: number;
	readonly debounceMs: number;
}

const DEFAULT_OPTIONS: ChangeBatcherOptions = {
	burstThreshold: 200,
	debounceMs: 100,
};

/** Waits for file changes to stop arriving, then emits them together; past a threshold it gives up following them and reports an overflow instead. */
export class ChangeBatcher extends AbstractDisposable {
	private buffer: FileChange[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | undefined;

	private readonly _onDidEmitChanges = this._register(
		new Emitter<FileChange[]>()
	);
	readonly onDidEmitChanges: Event<FileChange[]> =
		this._onDidEmitChanges.event;

	/** Too many changes to follow one by one; the buffer was dropped. */
	private readonly _onDidOverflow = this._register(
		new Emitter<ChangeBurst>()
	);
	readonly onDidOverflow: Event<ChangeBurst> = this._onDidOverflow.event;

	constructor(
		private readonly options: ChangeBatcherOptions = DEFAULT_OPTIONS
	) {
		super();
	}

	queueEvents(changes: readonly FileChange[]): void {
		// Not `push(...changes)`: a burst can be larger than the call stack allows.
		for (const change of changes) this.buffer.push(change);

		if (this.buffer.length > this.options.burstThreshold) {
			const dropped = this.buffer.length;
			this.clearBuffer();
			this._onDidOverflow.fire({
				dropped,
				threshold: this.options.burstThreshold,
			});
			return;
		}

		clearTimeout(this.flushTimer);
		this.flushTimer = setTimeout(
			() => this.flushBuffer(),
			this.options.debounceMs
		);
	}

	private flushBuffer(): void {
		this.flushTimer = undefined;
		const normalized = normalizeFileChanges(this.buffer);
		this.buffer = [];
		if (normalized.length > 0) {
			this._onDidEmitChanges.fire(normalized);
		}
	}

	private clearBuffer(): void {
		clearTimeout(this.flushTimer);
		this.flushTimer = undefined;
		this.buffer = [];
	}

	override [Symbol.dispose](): void {
		this.clearBuffer();
		super[Symbol.dispose]();
	}
}
