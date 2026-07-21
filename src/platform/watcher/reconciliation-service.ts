import { FileChange, normalizeFileChanges } from "./files.js";
import { Emitter, Event } from "../../base/event.js";
import { LogService } from "../log/log-service.js";
import { Disposable } from "../../base/disposable.js";

export interface ReconciliationOptions {
	readonly burstThreshold: number;
	readonly debounceMs: number;
}

export const DEFAULT_RECONCILIATION_OPTIONS: ReconciliationOptions = {
	burstThreshold: 200,
	debounceMs: 100,
};

export class ReconciliationService implements Disposable {
	private eventBuffer: FileChange[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private isLocked = false;

	private readonly _onDidEmitChanges = new Emitter<FileChange[]>();
	readonly onDidEmitChanges: Event<FileChange[]> =
		this._onDidEmitChanges.event;

	private readonly _onDidRequestReconciliation = new Emitter<void>();
	readonly onDidRequestReconciliation: Event<void> =
		this._onDidRequestReconciliation.event;

	constructor(
		private readonly logService: LogService,
		private readonly options: ReconciliationOptions = DEFAULT_RECONCILIATION_OPTIONS
	) {}

	queueEvents(changes: FileChange[]): void {
		for (const change of changes) {
			this.eventBuffer.push(change);
		}

		if (
			!this.isLocked &&
			this.eventBuffer.length > this.options.burstThreshold
		) {
			this.triggerFullReconciliation(this.eventBuffer.length);
			return;
		}

		if (!this.isLocked) {
			this.scheduleFlush();
		}
	}

	requestReconciliation(): void {
		if (this.isLocked) {
			return;
		}

		this.logService.info("Manual reconciliation requested.");
		this.clearBuffer();
		this._onDidRequestReconciliation.fire();
	}

	/**
	 * Locks the service during an active rescan.
	 * @throws Error if the service is already locked.
	 */
	acquireLock(): Disposable {
		if (this.isLocked) {
			throw new Error("ReconciliationService is already locked.");
		}

		this.isLocked = true;

		this.clearBuffer();

		return {
			[Symbol.dispose]: () => {
				this.isLocked = false;

				// Process events that arrived during rescan
				if (this.eventBuffer.length > 0) {
					if (this.eventBuffer.length > this.options.burstThreshold) {
						this.triggerFullReconciliation(this.eventBuffer.length);
					} else {
						this.scheduleFlush();
					}
				}
			},
		};
	}

	private scheduleFlush(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
		}
		this.flushTimer = setTimeout(
			() => this.flushBuffer(),
			this.options.debounceMs
		);
	}

	private triggerFullReconciliation(eventCount: number): void {
		this.logService.warn(
			`Threshold reached (${eventCount} > ${this.options.burstThreshold}). Requesting full reconciliation.`
		);
		this.clearBuffer();
		this._onDidRequestReconciliation.fire();
	}

	private flushBuffer(): void {
		this.flushTimer = null;

		if (this.eventBuffer.length > 0 && !this.isLocked) {
			const normalized = normalizeFileChanges(this.eventBuffer);
			this.eventBuffer = [];

			if (normalized.length > 0) {
				this._onDidEmitChanges.fire(normalized);
			}
		}
	}

	private clearBuffer(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		this.eventBuffer = [];
	}

	[Symbol.dispose](): void {
		this.clearBuffer();
		this._onDidEmitChanges[Symbol.dispose]();
		this._onDidRequestReconciliation[Symbol.dispose]();
	}
}
