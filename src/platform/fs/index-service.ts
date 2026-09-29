import { Event } from "../../base/event.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";
import { FileChange } from "./file-events.js";
import { FileType } from "./file-system-service.js";

/** What the build stages read from a listing of directories. */
export interface IndexReader {
	/** `undefined` when the directory was never indexed or doesn't exist. */
	getEntries(dirPath: string): ReadonlyMap<string, FileType> | undefined;
	hasEntry(dirPath: string, name: string): boolean;
	getEntryType(dirPath: string, name: string): FileType | undefined;
}

/**
 * An in-memory listing of the indexed directories, so later stages read
 * memory instead of the disk.
 */
export interface IndexService extends IndexReader {
	readonly _serviceBrand: undefined;

	/** Fires after `applyChanges` has updated the listing. */
	readonly onDidUpdate: Event<FileChange[]>;

	/** Runs after any earlier `initialize` or `ensureIndexed` finishes. Replaces the whole index in one step, so readers see the old listing until the new one is complete. A directory that doesn't exist isn't indexed. */
	initialize(sourcePaths: readonly string[]): Promise<void>;
	/** Indexes the dirs that no earlier call covers, where a dir inside a covered one counts as covered; the rest of the listing is kept. */
	ensureIndexed(dirs: readonly string[]): Promise<void>;
	/** Applies at once, never queued behind `initialize` or `ensureIndexed`; a scan in progress may overwrite a change to a dir it lists. */
	applyChanges(changes: FileChange[]): void;
}

export const IndexService =
	createServiceIdentifier<IndexService>("indexService");
