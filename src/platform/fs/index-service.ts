import path from "path";
import { FileSystemService, FileType } from "./file-system-service.js";
import { FileChange, FileChangeType } from "../watcher/files.js";
import { toPosix } from "../../base/path.js";
import { Emitter, Event } from "../../base/event.js";

export class IndexService {
	private readonly tree = new Map<string, Map<string, FileType>>();

	private readonly _onDidUpdate = new Emitter<FileChange[]>();
	readonly onDidUpdate: Event<FileChange[]> = this._onDidUpdate.event;

	constructor(private readonly fileSystem: FileSystemService) {}

	async initialize(sourcePaths: string[]): Promise<void> {
		this.tree.clear();

		const traverse = async (currentDir: string): Promise<void> => {
			const posixDir = toPosix(currentDir);
			if (!this.tree.has(posixDir)) {
				this.tree.set(posixDir, new Map());
			}

			let entries: [string, FileType][];
			try {
				entries = await this.fileSystem.readDirectory(currentDir);
			} catch (error) {
				if (
					error instanceof Error &&
					"code" in error &&
					error.code === "ENOENT"
				) {
					return;
				}
				throw error;
			}

			const children = this.tree.get(posixDir)!;
			const subdirs: string[] = [];

			for (const [name, type] of entries) {
				children.set(name, type);

				if (type === FileType.Directory) {
					subdirs.push(path.join(currentDir, name));
				}
			}

			await Promise.all(subdirs.map((subdir) => traverse(subdir)));
		};

		await Promise.all(sourcePaths.map((root) => traverse(root)));
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

					if (type === FileType.Directory) {
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
		if (type === FileType.Directory && !this.tree.has(fullPosixPath)) {
			this.tree.set(fullPosixPath, new Map());
		}
	}

	private removeDirectory(dirPath: string): void {
		const children = this.tree.get(dirPath);
		if (!children) return;

		for (const [name, type] of children.entries()) {
			if (type === FileType.Directory) {
				this.removeDirectory(`${dirPath}/${name}`);
			}
		}

		this.tree.delete(dirPath);
	}
}
