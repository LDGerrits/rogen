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
	readonly entries = new Map<string, Node>();
}

class LinkNode {
	readonly type = FileType.SymbolicLink;
	constructor(readonly target: string) {}
}

type Node = FileNode | DirectoryNode | LinkNode;

type FsErrorCode = "ENOENT" | "ENOTDIR" | "EISDIR" | "EEXIST" | "ELOOP";

interface Walk {
	readonly node?: Node;
	readonly realParts: readonly string[];
	readonly failure?: "ENOENT" | "ENOTDIR" | "ELOOP";
}

const MAX_LINK_HOPS = 40;

function mockFsError(code: FsErrorCode, message: string): Error {
	return Object.assign(new Error(message), { code });
}

const FAILURE_MESSAGES = {
	ENOENT: "no such file or directory",
	ENOTDIR: "not a directory",
	ELOOP: "too many symbolic links encountered",
};

function walkError(
	failure: keyof typeof FAILURE_MESSAGES,
	syscall: string,
	filePath: string
): Error {
	return mockFsError(
		failure,
		`${failure}: ${FAILURE_MESSAGES[failure]}, ${syscall} '${filePath}'`
	);
}

function isUnder(key: string, parent: string): boolean {
	return key === parent || key.startsWith(`${parent}/`);
}

function splitPath(filePath: string): string[] {
	return toPosix(filePath).split("/").filter(Boolean);
}

export class MemoryFileSystemService implements FileSystemService {
	declare readonly _serviceBrand: undefined;

	private root = new DirectoryNode();

	private readonly _onDidMutateFile = new Emitter<FileChange>();
	readonly onDidMutateFile: Event<FileChange> = this._onDidMutateFile.event;

	private _walk(
		filePath: string,
		followFinal: boolean,
		createMissing: boolean = false
	): Walk {
		let pending = splitPath(filePath);
		let realParts: string[] = [];
		let current: Node = this.root;
		let hops = 0;

		while (pending.length > 0) {
			const [name, ...rest] = pending;
			if (current.type !== FileType.Directory) {
				return { realParts, failure: "ENOTDIR" };
			}
			let child: Node | undefined = current.entries.get(name);
			if (!child) {
				if (!createMissing) return { realParts, failure: "ENOENT" };
				child = new DirectoryNode();
				current.entries.set(name, child);
			}
			if (
				child.type === FileType.SymbolicLink &&
				(rest.length > 0 || followFinal)
			) {
				if (++hops > MAX_LINK_HOPS) {
					return { realParts, failure: "ELOOP" };
				}
				pending = [...splitPath(child.target), ...rest];
				realParts = [];
				current = this.root;
				continue;
			}
			realParts.push(name);
			current = child;
			pending = rest;
		}
		return { node: current, realParts };
	}

	private _lookup(
		filePath: string,
		silent: boolean = true,
		followFinal: boolean = true
	): Node | undefined {
		const { node, failure } = this._walk(filePath, followFinal);
		if (!node && !silent) throw walkError(failure!, "stat", filePath);
		return node;
	}

	private _lookupParent(
		filePath: string,
		createMissing: boolean = false
	): DirectoryNode {
		const parts = splitPath(filePath);
		parts.pop();

		const { node, failure } = this._walk(
			parts.join("/"),
			true,
			createMissing
		);
		if (!node) throw walkError(failure!, "open", filePath);
		if (node.type !== FileType.Directory) {
			throw walkError("ENOTDIR", "open", filePath);
		}
		return node;
	}

	private _absoluteTarget(target: string, linkPath: string): string {
		if (!/^\.\.?([\\/]|$)/.test(target)) return target;

		const parts = splitPath(linkPath);
		parts.pop();
		const { realParts } = this._walk(parts.join("/"), true);
		const resolved = [...realParts];
		for (const part of splitPath(target)) {
			if (part === "..") resolved.pop();
			else if (part !== ".") resolved.push(part);
		}
		return resolved.join("/");
	}

	private _targetPath(filePath: string): string {
		const parts = splitPath(filePath);
		const name = parts.pop()!;
		const { realParts } = this._walk(parts.join("/"), true);
		const realKey = [...realParts, name].join("/");
		return realKey === splitPath(filePath).join("/")
			? toPosix(filePath)
			: (filePath.startsWith("/") ? "/" : "") + realKey;
	}

	private _typeOf(node: Node): FileType {
		if (node.type !== FileType.SymbolicLink) return node.type;
		const target = this._lookup(node.target)?.type ?? FileType.Unknown;
		return FileType.SymbolicLink | target;
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
			([name, child]) => [name, this._typeOf(child)]
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
				this._fire({
					type: FileChangeType.ADDED,
					path: currentPath,
					fileType: FileType.Directory,
				});
			}
			const resolved: Node | undefined =
				child.type === FileType.SymbolicLink
					? this._lookup(child.target)
					: child;
			if (resolved?.type !== FileType.Directory) {
				throw mockFsError(
					"EEXIST",
					`EEXIST: file already exists, mkdir '${currentPath}'`
				);
			}
			current = resolved;
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
		if (node?.type === FileType.SymbolicLink) {
			return this.writeFile(node.target, content);
		}
		const type = node ? FileChangeType.UPDATED : FileChangeType.ADDED;

		if (node && node.type === FileType.Directory) {
			throw mockFsError(
				"EISDIR",
				`EISDIR: illegal operation on a directory, write '${filePath}'`
			);
		}

		parent.entries.set(name, new FileNode(content));
		this._fire({
			type,
			path: this._targetPath(filePath),
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
		const node = this._lookup(source, false, false) as Node;
		const from = toPosix(source);
		const to = toPosix(destination);
		if (from === to) return;

		const existing = this._lookup(destination, true, false);
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

	private _emitDeleted(
		node: Node,
		currentPath: string,
		chain: readonly Node[] = []
	): void {
		const resolved = this._resolve(node);
		if (!resolved) return;
		if (resolved.type === FileType.Directory && !chain.includes(resolved)) {
			for (const [childName, childNode] of resolved.entries) {
				this._emitDeleted(childNode, `${currentPath}/${childName}`, [
					...chain,
					resolved,
				]);
			}
		}
		this._fire({
			type: FileChangeType.DELETED,
			path: currentPath,
			fileType: resolved.type,
		});
	}

	private _emitAdded(
		node: Node,
		currentPath: string,
		type: FileChangeType,
		chain: readonly Node[] = []
	): void {
		const resolved = this._resolve(node);
		if (!resolved) return;
		this._fire({ type, path: currentPath, fileType: resolved.type });
		if (resolved.type === FileType.Directory && !chain.includes(resolved)) {
			for (const [childName, childNode] of resolved.entries) {
				this._emitAdded(
					childNode,
					`${currentPath}/${childName}`,
					FileChangeType.ADDED,
					[...chain, resolved]
				);
			}
		}
	}

	private _resolve(node: Node): FileNode | DirectoryNode | undefined {
		if (node.type !== FileType.SymbolicLink) return node;
		const target = this._lookup(node.target);
		return target?.type === FileType.SymbolicLink ? undefined : target;
	}

	private _fire(change: FileChange): void {
		const links = this._collectLinks(this.root, "");
		const seen = new Set([splitPath(change.path).join("/")]);
		const pending = [{ change, via: new Set<string>() }];
		const leading = change.path.startsWith("/") ? "/" : "";

		for (const { change: current, via } of pending) {
			const key = splitPath(current.path).join("/");
			for (const link of links) {
				if (
					via.has(link.key) ||
					isUnder(key, link.key) ||
					!isUnder(key, link.targetKey)
				) {
					continue;
				}
				const aliasKey = link.key + key.slice(link.targetKey.length);
				if (seen.has(aliasKey)) continue;
				seen.add(aliasKey);
				pending.push({
					change: { ...current, path: leading + aliasKey },
					via: new Set([...via, link.key]),
				});
			}
		}
		for (const { change: each } of pending) {
			this._onDidMutateFile.fire(each);
		}
	}

	private _collectLinks(
		dir: DirectoryNode,
		dirKey: string
	): { key: string; targetKey: string }[] {
		const links: { key: string; targetKey: string }[] = [];
		for (const [name, child] of dir.entries) {
			const key = dirKey ? `${dirKey}/${name}` : name;
			if (child.type === FileType.SymbolicLink) {
				links.push({
					key,
					targetKey: splitPath(child.target).join("/"),
				});
			} else if (child.type === FileType.Directory) {
				links.push(...this._collectLinks(child, key));
			}
		}
		return links;
	}

	/** A target starting with `.` or `..` is relative to the link's directory; any other is a path from the root. */
	async createSymbolicLink(target: string, linkPath: string): Promise<void> {
		const parent = this._lookupParent(linkPath, true);
		const name = splitPath(linkPath).pop()!;
		if (parent.entries.has(name)) {
			throw mockFsError(
				"EEXIST",
				`EEXIST: file already exists, symlink '${target}' -> '${linkPath}'`
			);
		}
		const link = new LinkNode(this._absoluteTarget(target, linkPath));
		parent.entries.set(name, link);
		this._emitAdded(link, toPosix(linkPath), FileChangeType.ADDED);
	}

	async realPath(filePath: string): Promise<string> {
		const { node, realParts, failure } = this._walk(filePath, true);
		if (!node) throw walkError(failure!, "realpath", filePath);
		return `/${realParts.join("/")}`;
	}

	async readJson<T>(filePath: string): Promise<T> {
		return JSON.parse(await this.readFile(filePath));
	}
}
