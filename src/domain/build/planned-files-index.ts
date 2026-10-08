import path from "path";
import { ancestors, isInside, toPosix } from "../../base/path.js";
import { FileType } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { RojoFile } from "../rojo/rojo.js";

/** `index` with the source files that don't exist yet, and their folders, added on top; `index` itself is untouched. */
export class PlannedFilesIndex implements IndexReader {
	private readonly added = new Map<string, Map<string, FileType>>();

	constructor(
		private readonly index: IndexReader,
		rootDirs: readonly string[],
		paths: readonly string[]
	) {
		for (const target of paths) {
			const rootDir = rootDirs.find((dir) => isInside(target, dir));
			if (!rootDir || !new RojoFile(path.basename(target)).kind) continue;
			if (this.hasEntry(path.dirname(target), path.basename(target)))
				continue;

			this.add(target, FileType.File);
			for (const dir of ancestors(target)) {
				if (
					dir === rootDir ||
					this.hasEntry(path.dirname(dir), path.basename(dir))
				)
					break;
				this.add(dir, FileType.Directory);
			}
		}
	}

	/** Whether `target` is one of the paths added on top of the index, which doesn't exist. */
	isPlanned(target: string): boolean {
		return (
			this.added
				.get(toPosix(path.dirname(target)))
				?.has(path.basename(target)) === true
		);
	}

	getEntries(dir: string): ReadonlyMap<string, FileType> | undefined {
		const base = this.index.getEntries(dir);
		const extra = this.added.get(toPosix(dir));
		return extra ? new Map([...(base ?? []), ...extra]) : base;
	}

	hasEntry(dir: string, name: string): boolean {
		return (
			this.index.hasEntry(dir, name) ||
			this.added.get(toPosix(dir))?.has(name) === true
		);
	}

	getEntryType(dir: string, name: string): FileType | undefined {
		return (
			this.index.getEntryType(dir, name) ??
			this.added.get(toPosix(dir))?.get(name)
		);
	}

	private add(entry: string, type: FileType): void {
		const dir = toPosix(path.dirname(entry));
		const entries = this.added.get(dir) ?? new Map<string, FileType>();
		this.added.set(dir, entries.set(path.basename(entry), type));
	}
}
