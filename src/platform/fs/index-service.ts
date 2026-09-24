import { Event } from "../../base/event.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";
import { FileChange } from "./file-events.js";
import { FileType } from "./file-system-service.js";

/**
 * An in-memory listing of the indexed directories, so later stages read
 * memory instead of the disk.
 */
export interface IndexService {
	readonly _serviceBrand: undefined;

	/** Fires after `applyChanges` has updated the listing. */
	readonly onDidUpdate: Event<FileChange[]>;

	/** Replaces the whole index in one step, so readers see the old listing until the new one is complete. A directory that doesn't exist isn't indexed. */
	initialize(sourcePaths: readonly string[]): Promise<void>;
	applyChanges(changes: FileChange[]): void;

	/** `undefined` when the directory was never indexed or doesn't exist. */
	getEntries(dirPath: string): ReadonlyMap<string, FileType> | undefined;
	hasEntry(dirPath: string, name: string): boolean;
	getEntryType(dirPath: string, name: string): FileType | undefined;
}

export const IndexService =
	createServiceIdentifier<IndexService>("indexService");
