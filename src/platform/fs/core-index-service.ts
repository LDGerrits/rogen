import path from "path";
import {
	FileSystemService,
	FileType,
	isDirectoryType,
} from "./file-system-service.js";
import { Sequencer } from "../../base/async.js";
import { ErrorUtils } from "../../base/errors.js";
import {
	ancestors,
	contains,
	outermostDirs,
	toPosix,
} from "../../base/path.js";
import { FileChange, FileChangeType } from "./file-changes.js";
import { IndexService } from "./index-service.js";

const UNRESOLVED_CODES = ["ENOENT", "ENOTDIR", "ELOOP"];

export class CoreIndexService implements IndexService {
	declare readonly _serviceBrand: undefined;

	private tree = new Map<string, Map<string, FileType>>();
	/** The dirs asked for, whether or not they exist; none lies inside another. */
	private covered: readonly string[] = [];
	private readonly indexing = new Sequencer();

	constructor(private readonly fileSystemService: FileSystemService) {}

	initialize(sourcePaths: readonly string[]): Promise<void> {
		return this.indexing.queue(async () => {
			this.tree = await this.scan(sourcePaths);
			this.covered = outermostDirs(sourcePaths);
		});
	}

	ensureIndexed(dirs: readonly string[]): Promise<void> {
		return this.indexing.queue(async () => {
			const missing = outermostDirs(
				dirs.filter(
					(dir) => !this.covered.some((root) => contains(root, dir))
				)
			);
			if (missing.length === 0) return;
			for (const [dir, entries] of await this.scan(missing))
				this.tree.set(dir, entries);
			this.covered = outermostDirs([...this.covered, ...missing]);
		});
	}

	private async scan(
		dirs: readonly string[]
	): Promise<Map<string, Map<string, FileType>>> {
		const next = new Map<string, Map<string, FileType>>();
		await Promise.all(dirs.map((root) => this.traverse(root, next)));
		return next;
	}

	private async traverse(
		currentDir: string,
		into: Map<string, Map<string, FileType>>
	): Promise<void> {
		const entries = await this.readDirectory(currentDir);
		if (!entries) return;

		const children = new Map<string, FileType>();
		into.set(toPosix(currentDir), children);
		const subdirs: string[] = [];

		for (const [name, listed] of entries) {
			const entryPath = path.join(currentDir, name);
			const type = await this.classify(entryPath, listed);
			children.set(name, type);
			if (isDirectoryType(type)) subdirs.push(entryPath);
		}

		await Promise.all(subdirs.map((subdir) => this.traverse(subdir, into)));
	}

	/** `undefined` when the directory doesn't exist, or is no longer a directory when `replaced` allows that. */
	private async readDirectory(
		dir: string,
		replaced = false
	): Promise<[string, FileType][] | undefined> {
		try {
			return await this.fileSystemService.readDirectory(dir);
		} catch (error) {
			if (ErrorUtils.hasCode(error, "ENOENT")) return undefined;
			if (replaced && ErrorUtils.hasCode(error, "ENOTDIR"))
				return undefined;
			throw error;
		}
	}

	/** A linked directory that leads back to an ancestor is recorded as only a link, so nothing descends into it. */
	private async classify(
		entryPath: string,
		listed: FileType
	): Promise<FileType> {
		return listed & FileType.SymbolicLink &&
			isDirectoryType(listed) &&
			(await this.linksToAncestor(entryPath))
			? FileType.SymbolicLink
			: listed;
	}

	private async linksToAncestor(linkPath: string): Promise<boolean> {
		let target: string;
		try {
			target = await this.fileSystemService.realPath(linkPath);
		} catch (error) {
			if (ErrorUtils.hasCode(error, ...UNRESOLVED_CODES)) return true;
			throw error;
		}

		for (const ancestor of ancestors(linkPath)) {
			try {
				if (
					(await this.fileSystemService.realPath(ancestor)) === target
				)
					return true;
			} catch (error) {
				if (!ErrorUtils.hasCode(error, ...UNRESOLVED_CODES))
					throw error;
			}
		}
		return false;
	}

	getEntries(dirPath: string): ReadonlyMap<string, FileType> | undefined {
		return this.tree.get(toPosix(dirPath));
	}

	hasEntry(dirPath: string, name: string): boolean {
		const posixDir = toPosix(dirPath);
		return this.tree.get(posixDir)?.has(name) ?? false;
	}

	getEntryType(dirPath: string, name: string): FileType | undefined {
		const posixDir = toPosix(dirPath);
		return this.tree.get(posixDir)?.get(name);
	}

	applyChanges(changes: readonly FileChange[]): Promise<void> {
		return this.indexing.queue(async () => {
			const listings = new Map<
				string,
				Map<string, FileType> | undefined
			>();
			const listingOf = async (dir: string) => {
				if (!listings.has(dir)) {
					const entries = await this.readDirectory(dir, true);
					listings.set(dir, entries && new Map(entries));
				}
				return listings.get(dir);
			};

			for (const change of changes) {
				const posixPath = toPosix(change.path);
				const dir = toPosix(path.dirname(posixPath));
				const name = path.basename(posixPath);

				if (change.type === FileChangeType.ADDED) {
					if (this.liesUnderLink(posixPath)) continue;
					const listed = (await listingOf(dir))?.get(name);
					if (listed === undefined) continue;
					await this.addEntry(
						dir,
						name,
						await this.classify(posixPath, listed)
					);
				} else if (change.type === FileChangeType.DELETED) {
					this.deleteEntry(dir, name);
				}
			}
		});
	}

	/** Whether an ancestor of `posixPath` is recorded as something other than a directory, such as a link nothing descends into. */
	private liesUnderLink(posixPath: string): boolean {
		for (let child = path.posix.dirname(posixPath); ;) {
			const parent = path.posix.dirname(child);
			if (parent === child) return false;
			const type = this.tree.get(parent)?.get(path.posix.basename(child));
			if (type !== undefined && !isDirectoryType(type)) return true;
			child = parent;
		}
	}

	private async addEntry(
		posixDir: string,
		name: string,
		type: FileType
	): Promise<void> {
		if (!this.tree.has(posixDir)) {
			this.tree.set(posixDir, new Map());
		}
		const previous = this.tree.get(posixDir)!.get(name);
		this.tree.get(posixDir)!.set(name, type);

		// A directory already indexed is kept; the changes under it arrive on their own.
		const fullPosixPath = posixDir === "." ? name : `${posixDir}/${name}`;
		if (previous === type && this.tree.has(fullPosixPath)) return;
		if (previous !== undefined && isDirectoryType(previous))
			this.removeDirectory(fullPosixPath);
		if (isDirectoryType(type))
			await this.traverse(fullPosixPath, this.tree);
	}

	private deleteEntry(posixDir: string, name: string): void {
		const parentMap = this.tree.get(posixDir);
		if (!parentMap) return;
		const type = parentMap.get(name);
		parentMap.delete(name);
		if (type !== undefined && isDirectoryType(type)) {
			this.removeDirectory(
				posixDir === "." ? name : `${posixDir}/${name}`
			);
		}
	}

	private removeDirectory(dirPath: string): void {
		const children = this.tree.get(dirPath);
		if (!children) return;

		for (const [name, type] of children.entries()) {
			if (isDirectoryType(type)) {
				this.removeDirectory(`${dirPath}/${name}`);
			}
		}

		this.tree.delete(dirPath);
	}
}
