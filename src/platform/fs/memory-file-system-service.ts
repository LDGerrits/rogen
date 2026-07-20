import { FileType, FileSystemService } from "./file-system-service.js";
import { Emitter, Event } from "../../base/event.js";
import { FileChange, FileChangeType } from "../watcher/files.js";
import { toPosix } from "../../base/path.js";

export class MemoryFileSystemService implements FileSystemService {
	files = new Map<string, string>();

	private readonly _onDidMutateFile = new Emitter<FileChange>();
	readonly onDidMutateFile: Event<FileChange> = this._onDidMutateFile.event;

	async exists(filePath: string): Promise<boolean> {
		const p = toPosix(filePath);
		return (
			this.files.has(p) ||
			Array.from(this.files.keys()).some((k) => k.startsWith(p + "/"))
		);
	}

	async isFile(filePath: string): Promise<boolean> {
		return this.files.has(toPosix(filePath));
	}

	async isDirectory(filePath: string): Promise<boolean> {
		const p = toPosix(filePath);
		return (
			!this.files.has(p) &&
			Array.from(this.files.keys()).some((k) => k.startsWith(p + "/"))
		);
	}

	async readDirectory(filePath: string): Promise<[string, FileType][]> {
		const dirPath = toPosix(filePath) + "/";
		const entries = new Set<string>();
		const result: [string, FileType][] = [];

		for (const [p] of this.files) {
			if (p.startsWith(dirPath)) {
				const relative = p.slice(dirPath.length);
				const parts = relative.split("/");
				const name = parts[0];

				if (!entries.has(name)) {
					entries.add(name);
					result.push([
						name,
						parts.length === 1 ? FileType.File : FileType.Directory,
					]);
				}
			}
		}
		return result;
	}

	async createDirectory(_filePath: string): Promise<void> {}

	async readFile(filePath: string): Promise<string> {
		const p = toPosix(filePath);
		if (!this.files.has(p))
			throw new Error(`ENOENT: no such file, open '${filePath}'`);
		return this.files.get(p)!;
	}

	async writeFile(filePath: string, content: string): Promise<void> {
		const p = toPosix(filePath);
		const type = this.files.has(p)
			? FileChangeType.UPDATED
			: FileChangeType.ADDED;

		this.files.set(p, content);
		this._onDidMutateFile.fire({ type, path: p });
	}

	async delete(filePath: string, recursive: boolean = false): Promise<void> {
		const p = toPosix(filePath);
		let wasImplicitDirectory = false;

		// Delete nested files
		if (recursive) {
			for (const key of this.files.keys()) {
				if (key.startsWith(p + "/")) {
					wasImplicitDirectory = true;
					this.files.delete(key);
					this._onDidMutateFile.fire({
						type: FileChangeType.DELETED,
						path: key,
					});
				}
			}
		}

		// Delete path if direct file
		if (this.files.has(p)) {
			this.files.delete(p);
			this._onDidMutateFile.fire({
				type: FileChangeType.DELETED,
				path: p,
			});
		}
		// Delete folder if children are gone
		else if (wasImplicitDirectory) {
			this._onDidMutateFile.fire({
				type: FileChangeType.DELETED,
				path: p,
			});
		}
	}

	async copy(source: string, destination: string): Promise<void> {
		const content = await this.readFile(source);
		await this.writeFile(destination, content);
	}

	async readJson<T>(filePath: string): Promise<T> {
		const content = await this.readFile(filePath);
		return JSON.parse(content) as T;
	}
}
