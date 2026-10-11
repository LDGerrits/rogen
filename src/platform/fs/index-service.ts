import { toPosix } from "../../base/path.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";
import { FileChange } from "./file-changes.js";
import { FileType } from "./file-system-service.js";

/** A listing of directories, read in memory. */
export interface IndexReader {
	/** `undefined` when the directory was never listed or doesn't exist. */
	getEntries(dirPath: string): ReadonlyMap<string, FileType> | undefined;
	hasEntry(dirPath: string, name: string): boolean;
	getEntryType(dirPath: string, name: string): FileType | undefined;
}

/** The entries of every listed directory, by posix path. A listing never changes: an update makes a new one. */
export class Listing implements IndexReader {
	static readonly EMPTY = new Listing(new Map());

	constructor(
		readonly directories: ReadonlyMap<string, ReadonlyMap<string, FileType>>
	) {}

	getEntries(dirPath: string): ReadonlyMap<string, FileType> | undefined {
		return this.directories.get(toPosix(dirPath));
	}

	hasEntry(dirPath: string, name: string): boolean {
		return this.getEntries(dirPath)?.has(name) ?? false;
	}

	getEntryType(dirPath: string, name: string): FileType | undefined {
		return this.getEntries(dirPath)?.get(name);
	}
}

/** Lists directories into memory, so a build reads memory instead of the disk. Holds nothing itself: each listing belongs to whoever asked for it. */
export interface IndexService {
	readonly _serviceBrand: undefined;

	/** Lists `dirs` and everything under them. A directory that doesn't exist isn't listed. */
	list(dirs: readonly string[]): Promise<Listing>;
	/** `base` with `changes` applied, as a fresh listing would have them: an added entry's type is read from the disk, not the change, an added directory is listed whole, and an entry that is gone by then is skipped. `base` itself is left as it was. */
	update(base: Listing, changes: readonly FileChange[]): Promise<Listing>;
}

export const IndexService =
	createServiceIdentifier<IndexService>("indexService");
