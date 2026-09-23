import { Disposable } from "../../base/disposable.js";
import { Event } from "../../base/event.js";
import { FileChange } from "../fs/file-events.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface ReconciliationService {
	readonly _serviceBrand: undefined;

	readonly onDidEmitChanges: Event<FileChange[]>;
	readonly onDidRequestReconciliation: Event<void>;

	queueEvents(changes: FileChange[]): void;
	requestReconciliation(): void;

	/**
	 * Locks the service during an active rescan.
	 * @throws Error if the service is already locked.
	 */
	acquireLock(): Disposable;
}

export const ReconciliationService =
	createServiceIdentifier<ReconciliationService>("reconciliationService");
