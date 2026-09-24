import { FileType, FileSystemService } from "./file-system-service.js";
import { Emitter, Event } from "../../base/event.js";
import { toPosix } from "../../base/path.js";
import { FileChange, FileChangeType } from "./file-events.js";

class FileNode {
	readonly type = FileType.File;
	constructor(public content: string = "") {}
}

class DirectoryNode {
	readonly type = FileType.Directory;
	readonly entries = new Map<string, FileNode | DirectoryNode>();
}

type Node = FileNode | DirectoryNode;

function mockFsError(
	code: "ENOENT" | "ENOTDIR" | "EISDIR" | "EEXIST",
	message: string
): Error {
	return Object.assign(new Error(message), { code });
}

export class MemoryFileSystemService implements FileSystemService {
	declare readonly _serviceBrand: undefined;

	private root = new DirectoryNode();

	private readonly _onDidMutateFile = new Emitter<FileChange>();
	readonly onDidMutateFile: Event<FileChange> = this._onDidMutateFile.event;

	private _lookup(
		filePath: string,
		silent: boolean = true
	): Node | undefined {
		const parts = toPosix(filePath).split("/").filter(Boolean);
		let current: Node = this.root;

		for (const part of parts) {
			if (current.type === FileType.Directory) {
				const child: Node | undefined = current.entries.get(part);
				if (!child) {
					if (!silent)
						throw mockFsError(
							"ENOENT",
							`ENOENT: no such file or directory, stat '${filePath}'`
						);
					return undefined;
				}
				current = child;
			} else {
				if (!silent)
					throw mockFsError(
						"ENOTDIR",
						`ENOTDIR: not a directory, stat '${filePath}'`
					);
				return undefined;
			}
		}
		return current;
	}

	private _lookupParent(
		filePath: string,
		createMissing: boolean = false
	): DirectoryNode {
		const parts = toPosix(filePath).split("/").filter(Boolean);
		parts.pop();

		let current: Node = this.root;
		for (const part of parts) {
			let child: Node | undefined = (
				current as DirectoryNode
			).entries.get(part);

			if (!child) {
				if (createMissing) {
					child = new DirectoryNode();
					(current as DirectoryNode).entries.set(part, child);
				} else {
					throw mockFsError(
						"ENOENT",
						`ENOENT: no such file or directory`
					);
				}
			}
			if (child.type === FileType.File) {
				throw mockFsError("ENOTDIR", `ENOTDIR: not a directory`);
			}
			current = child;
		}
		return current as DirectoryNode;
	}

	async exists(filePath: string): Promise<boolean> {
		return this._lookup(filePath) !== undefined;
	}

	async isFile(filePath: string): Promise<boolean> {
		return this._lookup(filePath)?.type === FileType.File;
	}

	async isDirectory(filePath: string): Promise<boolean> {
		return this._lookup(filePath)?.type === FileType.Directory;
	}

	async readDirectory(filePath: string): Promise<[string, FileType][]> {
		const node = this._lookup(filePath, false);
		if (node?.type !== FileType.Directory) {
			throw mockFsError(
				"ENOTDIR",
				`ENOTDIR: not a directory, scandir '${filePath}'`
			);
		}
		return Array.from((node as DirectoryNode).entries.entries()).map(
			([name, child]) => [name, child.type]
		);
	}

	async createDirectory(filePath: string): Promise<void> {
		const parts = toPosix(filePath).split("/").filter(Boolean);
		let current: Node = this.root;
		let currentPath = "";

		for (const part of parts) {
			currentPath += (currentPath ? "/" : "") + part;

			let child: Node | undefined = (
				current as DirectoryNode
			).entries.get(part);

			if (!child) {
				child = new DirectoryNode();
				(current as DirectoryNode).entries.set(part, child);
				this._onDidMutateFile.fire({
					type: FileChangeType.ADDED,
					path: currentPath,
					fileType: FileType.Directory,
				});
			} else if (child.type === FileType.File) {
				throw mockFsError(
					"EEXIST",
					`EEXIST: file already exists, mkdir '${currentPath}'`
				);
			}
			current = child;
		}
	}

	async readFile(filePath: string): Promise<string> {
		const node = this._lookup(filePath, false);
		if (node?.type === FileType.Directory) {
			throw mockFsError(
				"EISDIR",
				`EISDIR: illegal operation on a directory, read '${filePath}'`
			);
		}
		return (node as FileNode).content;
	}

	async writeFile(filePath: string, content: string): Promise<void> {
		const parent = this._lookupParent(filePath, true);
		const name = toPosix(filePath).split("/").pop()!;

		const node = parent.entries.get(name);
		const type = node ? FileChangeType.UPDATED : FileChangeType.ADDED;

		if (node && node.type === FileType.Directory) {
			throw mockFsError(
				"EISDIR",
				`EISDIR: illegal operation on a directory, write '${filePath}'`
			);
		}

		parent.entries.set(name, new FileNode(content));
		this._onDidMutateFile.fire({
			type,
			path: toPosix(filePath),
			fileType: FileType.File,
		});
	}

	async delete(filePath: string, recursive: boolean = false): Promise<void> {
		const parent = this._lookupParent(filePath);
		const name = toPosix(filePath).split("/").pop()!;
		const target = parent.entries.get(name);

		if (!target) return;

		if (target.type === FileType.Directory && !recursive) {
			throw mockFsError(
				"EISDIR",
				`EISDIR: illegal operation on a directory, rm '${filePath}'`
			);
		}

		parent.entries.delete(name);

		this._emitDeleted(target, toPosix(filePath));
	}

	async copy(
		source: string,
		destination: string,
		overwrite: boolean = false
	): Promise<void> {
		if (!overwrite && (await this.exists(destination))) {
			throw mockFsError(
				"EEXIST",
				`EEXIST: file already exists, copyfile '${source}' -> '${destination}'`
			);
		}
		const content = await this.readFile(source);
		await this.writeFile(destination, content);
	}

	async rename(
		source: string,
		destination: string,
		overwrite: boolean = false
	): Promise<void> {
		const node = this._lookup(source, false) as Node;
		const from = toPosix(source);
		const to = toPosix(destination);
		if (from === to) return;

		const existing = this._lookup(destination);
		if (existing && !overwrite) {
			throw mockFsError(
				"EEXIST",
				`EEXIST: file already exists, rename '${source}' -> '${destination}'`
			);
		}
		if (existing?.type === FileType.Directory) {
			throw mockFsError(
				"EISDIR",
				`EISDIR: illegal operation on a directory, rename '${source}' -> '${destination}'`
			);
		}

		const target = this._lookupParent(destination, true);
		this._lookupParent(source).entries.delete(from.split("/").pop()!);
		target.entries.set(to.split("/").pop()!, node);

		this._emitDeleted(node, from);
		this._emitAdded(
			node,
			to,
			existing ? FileChangeType.UPDATED : FileChangeType.ADDED
		);
	}

	private _emitDeleted(node: Node, currentPath: string): void {
		if (node.type === FileType.Directory) {
			for (const [childName, childNode] of node.entries) {
				this._emitDeleted(childNode, `${currentPath}/${childName}`);
			}
		}
		this._onDidMutateFile.fire({
			type: FileChangeType.DELETED,
			path: currentPath,
			fileType: node.type,
		});
	}

	private _emitAdded(
		node: Node,
		currentPath: string,
		type: FileChangeType
	): void {
		this._onDidMutateFile.fire({
			type,
			path: currentPath,
			fileType: node.type,
		});
		if (node.type === FileType.Directory) {
			for (const [childName, childNode] of node.entries) {
				this._emitAdded(
					childNode,
					`${currentPath}/${childName}`,
					FileChangeType.ADDED
				);
			}
		}
	}

	async readJson<T>(filePath: string): Promise<T> {
		return JSON.parse(await this.readFile(filePath));
	}
}
