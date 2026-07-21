/**
 * An attempt to rework VSCode's 'InMemoryFileSystemProvider' to use the
 * 'FileSystemService' interface. It emulates a real file system in order to
 * make testing easier, safer and more powerful.
 */

import { FileType, FileSystemService } from "./file-system-service.js";
import { Emitter, Event } from "../../base/event.js";
import { FileChange, FileChangeType } from "../watcher/files.js";
import { toPosix } from "../../base/path.js";

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
				const child = (current as DirectoryNode).entries.get(part);
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
		this._onDidMutateFile.fire({ type, path: toPosix(filePath) });
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

		const emitDeletes = (node: Node, currentPath: string) => {
			// Safe property check to ensure it works properly in Jest
			if (node.type === FileType.Directory) {
				for (const [childName, childNode] of (node as DirectoryNode)
					.entries) {
					emitDeletes(childNode, `${currentPath}/${childName}`);
				}
			}
			this._onDidMutateFile.fire({
				type: FileChangeType.DELETED,
				path: currentPath,
			});
		};

		emitDeletes(target, toPosix(filePath));
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

	async readJson<T>(filePath: string): Promise<T> {
		return JSON.parse(await this.readFile(filePath));
	}
}
