import path from "path";
import {
	FileSystemService,
	FileType,
	isDirectoryType,
} from "./file-system-service.js";
import { Sequencer } from "../../base/async.js";
import { ErrorUtils } from "../../base/errors.js";
import { AbstractDisposable } from "../../base/disposable.js";
import {
	ancestors,
	contains,
	outermostDirs,
	toPosix,
} from "../../base/path.js";
import { Emitter, Event } from "../../base/event.js";
import { FileChange, FileChangeType } from "./file-events.js";
import { IndexService } from "./index-service.js";

const UNRESOLVED_CODES = ["ENOENT", "ENOTDIR", "ELOOP"];

export class CoreIndexService
	extends AbstractDisposable
	implements IndexService
{
	declare readonly _serviceBrand: undefined;

	private tree = new Map<string, Map<string, FileType>>();
	/** The dirs asked for, whether or not they exist; none lies inside another. */
	private covered: readonly string[] = [];
	private readonly indexing = new Sequencer();

	private readonly _onDidUpdate = this._register(new Emitter<FileChange[]>());
	readonly onDidUpdate: Event<FileChange[]> = this._onDidUpdate.event;

	constructor(private readonly fileSystemService: FileSystemService) {
		super();
	}

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

		const traverse = async (currentDir: string): Promise<void> => {
			const posixDir = toPosix(currentDir);

			let entries: [string, FileType][];
			try {
				entries =
					await this.fileSystemService.readDirectory(currentDir);
			} catch (error) {
				if (ErrorUtils.hasCode(error, "ENOENT")) return;
				throw error;
			}

			const children = new Map<string, FileType>();
			next.set(posixDir, children);
			const subdirs: string[] = [];

			for (const [name, type] of entries) {
				const entryPath = path.join(currentDir, name);
				if (
					type & FileType.SymbolicLink &&
					isDirectoryType(type) &&
					(await this.linksToAncestor(entryPath))
				) {
					children.set(name, FileType.SymbolicLink);
					continue;
				}

				children.set(name, type);
				if (isDirectoryType(type)) subdirs.push(entryPath);
			}

			await Promise.all(subdirs.map((subdir) => traverse(subdir)));
		};

		await Promise.all(dirs.map((root) => traverse(root)));
		return next;
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

	applyChanges(changes: FileChange[]): void {
		for (const change of changes) {
			const posixPath = toPosix(change.path);
			const dir = toPosix(path.dirname(posixPath));
			const name = path.basename(posixPath);

			if (change.type === FileChangeType.ADDED) {
				this.addEntry(dir, name, change.fileType);
			} else if (change.type === FileChangeType.DELETED) {
				const parentMap = this.tree.get(dir);
				if (parentMap) {
					const type = parentMap.get(name);
					parentMap.delete(name);

					if (type !== undefined && isDirectoryType(type)) {
						this.removeDirectory(posixPath);
					}
				}
			}
		}

		this._onDidUpdate.fire(changes);
	}

	private addEntry(posixDir: string, name: string, type: FileType): void {
		if (!this.tree.has(posixDir)) {
			this.tree.set(posixDir, new Map());
		}

		this.tree.get(posixDir)!.set(name, type);

		const fullPosixPath = posixDir === "." ? name : `${posixDir}/${name}`;
		if (isDirectoryType(type) && !this.tree.has(fullPosixPath)) {
			this.tree.set(fullPosixPath, new Map());
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
