import { toPosix } from "../../base/path.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";
import { FileChange } from "./file-changes.js";
import { FileType } from "./file-system-service.js";

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

/** Lists directories into memory so a write reads memory, not the disk. Holds nothing itself. */
export interface IndexService {
	readonly _serviceBrand: undefined;

	list(dirs: readonly string[]): Promise<Listing>;
	/** `base` with `changes` applied as a fresh listing would have them; `base` is unchanged. */
	update(base: Listing, changes: readonly FileChange[]): Promise<Listing>;
}

export const IndexService =
	createServiceIdentifier<IndexService>("indexService");
