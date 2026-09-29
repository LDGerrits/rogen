import path from "path";
import { ancestors, isInside, toPosix } from "../../base/path.js";
import { FileType } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { classifyFile } from "../rojo/rojo-files.js";

/** `index` with the source files that don't exist yet, and their folders, added on top; `index` itself is untouched. */
export function withPlannedFiles(
	index: IndexReader,
	rootDirs: readonly string[],
	paths: readonly string[]
): IndexReader {
	const added = new Map<string, Map<string, FileType>>();
	const addedTo = (dir: string) => added.get(toPosix(dir));
	const has = (dir: string, name: string) =>
		index.hasEntry(dir, name) || addedTo(dir)?.has(name) === true;
	const add = (entry: string, type: FileType) => {
		const dir = toPosix(path.dirname(entry));
		const entries = added.get(dir) ?? new Map<string, FileType>();
		added.set(dir, entries.set(path.basename(entry), type));
	};

	for (const target of paths) {
		const rootDir = rootDirs.find((dir) => isInside(target, dir));
		if (!rootDir || !classifyFile(path.basename(target))) continue;
		if (has(path.dirname(target), path.basename(target))) continue;

		add(target, FileType.File);
		for (const dir of ancestors(target)) {
			if (dir === rootDir || has(path.dirname(dir), path.basename(dir)))
				break;
			add(dir, FileType.Directory);
		}
	}

	return {
		getEntries: (dir) => {
			const base = index.getEntries(dir);
			const extra = addedTo(dir);
			return extra ? new Map([...(base ?? []), ...extra]) : base;
		},
		hasEntry: has,
		getEntryType: (dir, name) =>
			index.getEntryType(dir, name) ?? addedTo(dir)?.get(name),
	};
}
