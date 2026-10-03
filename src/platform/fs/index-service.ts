import { createServiceIdentifier } from "../instantiation/instantiation.js";
import { FileChange } from "./file-changes.js";
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

	/** Runs after any earlier `initialize` or `ensureIndexed` finishes. Replaces the whole index in one step, so readers see the old listing until the new one is complete. A directory that doesn't exist isn't indexed. */
	initialize(sourcePaths: readonly string[]): Promise<void>;
	/** Indexes the dirs that no earlier call covers, where a dir inside a covered one counts as covered; the rest of the listing is kept. */
	ensureIndexed(dirs: readonly string[]): Promise<void>;
	/**
	 * Runs after any earlier call finishes, and leaves the index as a rescan
	 * would: an added entry's type is read from the disk, not the change, an
	 * added directory is indexed whole, and an entry that is gone by then is
	 * skipped.
	 */
	applyChanges(changes: readonly FileChange[]): Promise<void>;
}

export const IndexService =
	createServiceIdentifier<IndexService>("indexService");
