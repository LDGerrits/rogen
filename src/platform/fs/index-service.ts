import { toPosix } from "../../base/path.js";
import { createDecorator } from "../instantiation/instantiation.js";
import { FileChange } from "./file-changes.js";
import { FileReader, FileType } from "./file-system-service.js";

export interface IndexReader {
	getEntries(dirPath: string): ReadonlyMap<string, FileType> | undefined;
	hasEntry(dirPath: string, name: string): boolean;
	getEntryType(dirPath: string, name: string): FileType | undefined;
	isUnreadable(dirPath: string): boolean;
}

export class Listing implements IndexReader {
	static readonly EMPTY = new Listing(new Map());

	constructor(
		readonly directories: ReadonlyMap<
			string,
			ReadonlyMap<string, FileType>
		>,
		readonly unreadable: ReadonlySet<string> = new Set()
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

	isUnreadable(dirPath: string): boolean {
		return this.unreadable.has(toPosix(dirPath));
	}
}

export interface IndexService {
	readonly _serviceBrand: undefined;

	list(dirs: readonly string[], reader?: FileReader): Promise<Listing>;
	update(base: Listing, changes: readonly FileChange[]): Promise<Listing>;
}

export const IndexService = createDecorator<IndexService>("indexService");
