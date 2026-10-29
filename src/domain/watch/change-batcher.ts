import { RunOnceScheduler } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import {
	FileChange,
	normalizeFileChanges,
} from "../../platform/fs/file-changes.js";
import { ChangeBurst } from "./watch-service.js";

interface ChangeBatcherOptions {
	readonly burstThreshold: number;
	readonly debounceMs: number;
}

// Longer than chokidar's 100 ms atomic-write delay, so an editor's temporary file add and delete cancel out.
const DEFAULT_OPTIONS: ChangeBatcherOptions = {
	burstThreshold: 200,
	debounceMs: 200,
};

/** Emits file changes together once they stop arriving; past a threshold it reports an overflow instead. */
export class ChangeBatcher extends AbstractDisposable {
	private buffer: FileChange[] = [];
	private droppedInBurst: number | undefined;
	private readonly flush: RunOnceScheduler;

	private readonly _onDidEmitChanges = this._register(
		new Emitter<FileChange[]>()
	);
	readonly onDidEmitChanges: Event<FileChange[]> =
		this._onDidEmitChanges.event;

	private readonly _onDidOverflow = this._register(
		new Emitter<ChangeBurst>()
	);
	readonly onDidOverflow: Event<ChangeBurst> = this._onDidOverflow.event;

	private readonly options: ChangeBatcherOptions;

	constructor(options: Partial<ChangeBatcherOptions> = {}) {
		super();
		this.options = { ...DEFAULT_OPTIONS, ...options };
		this.flush = this._register(
			new RunOnceScheduler(
				() => this.flushBuffer(),
				this.options.debounceMs
			)
		);
	}

	queueEvents(changes: readonly FileChange[]): void {
		if (this.droppedInBurst !== undefined) {
			this.droppedInBurst += changes.length;
			this.flush.schedule();
			return;
		}
		// Not `push(...changes)`: a burst can be larger than the call stack allows.
		for (const change of changes) this.buffer.push(change);

		if (this.buffer.length > this.options.burstThreshold) {
			const dropped = this.buffer.length;
			this.clearBuffer();
			this._onDidOverflow.fire({
				dropped,
				threshold: this.options.burstThreshold,
				ended: false,
			});
			this.droppedInBurst = 0;
			this.flush.schedule();
			return;
		}

		this.flush.schedule();
	}

	private flushBuffer(): void {
		if (this.droppedInBurst !== undefined) {
			const dropped = this.droppedInBurst;
			this.droppedInBurst = undefined;
			if (dropped > 0)
				this._onDidOverflow.fire({
					dropped,
					threshold: this.options.burstThreshold,
					ended: true,
				});
			return;
		}
		const normalized = normalizeFileChanges(this.buffer);
		this.buffer = [];
		if (normalized.length > 0) {
			this._onDidEmitChanges.fire(normalized);
		}
	}

	private clearBuffer(): void {
		this.flush.cancel();
		this.buffer = [];
	}

	override [Symbol.dispose](): void {
		this.buffer = [];
		super[Symbol.dispose]();
	}
}
