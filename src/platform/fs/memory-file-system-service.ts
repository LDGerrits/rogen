import {
	FileType,
	FileSystemService,
	fileSystemError,
	renameRefusal,
} from "./file-system-service.js";
import { compareStrings } from "../../base/collections.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { containsPosix, toPosix } from "../../base/path.js";
import { FileChange, FileChangeType } from "./file-changes.js";

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

interface Walk {
	readonly node?: Node;
	readonly realParts: readonly string[];
	readonly failure?: "ENOENT" | "ENOTDIR" | "ELOOP";
}

const MAX_LINK_HOPS = 40;

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
	return fileSystemError(
		failure,
		`${failure}: ${FAILURE_MESSAGES[failure]}, ${syscall} '${filePath}'`
	);
}

function splitPath(filePath: string): string[] {
	return toPosix(filePath).split("/").filter(Boolean);
}

export class MemoryFileSystemService
	extends AbstractDisposable
	implements FileSystemService
{
	declare readonly _serviceBrand: undefined;

	private root = new DirectoryNode();

	private readonly _onDidMutateFile = this._register(
		new Emitter<FileChange>()
	);
	readonly onDidMutateFile: Event<FileChange> = this._onDidMutateFile.event;

	private walk(
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

	private lookup(filePath: string): Node | undefined {
		return this.walk(filePath, true).node;
	}

	private lookupOrThrow(filePath: string): Node {
		const { node, failure } = this.walk(filePath, true);
		if (!node) throw walkError(failure!, "stat", filePath);
		return node;
	}

	private parentOf(filePath: string): DirectoryNode {
		return this.parentDirectory(filePath, false);
	}

	private parentOrCreate(filePath: string): DirectoryNode {
		return this.parentDirectory(filePath, true);
	}

	private parentDirectory(
		filePath: string,
		createMissing: boolean
	): DirectoryNode {
		const parts = splitPath(filePath);
		parts.pop();

		const { node, failure } = this.walk(
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

	private absoluteTarget(target: string, linkPath: string): string {
		if (!/^\.\.?([\\/]|$)/.test(target)) return target;

		const parts = splitPath(linkPath);
		parts.pop();
		const { realParts } = this.walk(parts.join("/"), true);
		const resolved = [...realParts];
		for (const part of splitPath(target)) {
			if (part === "..") resolved.pop();
			else if (part !== ".") resolved.push(part);
		}
		return resolved.join("/");
	}

	private targetPath(filePath: string): string {
		const parts = splitPath(filePath);
		const name = parts.pop()!;
		const { realParts } = this.walk(parts.join("/"), true);
		const realKey = [...realParts, name].join("/");
		return realKey === splitPath(filePath).join("/")
			? toPosix(filePath)
			: (filePath.startsWith("/") ? "/" : "") + realKey;
	}

	private typeOf(node: Node): FileType {
		if (node.type !== FileType.SymbolicLink) return node.type;
		const target = this.lookup(node.target)?.type ?? FileType.Unknown;
		return FileType.SymbolicLink | target;
	}

	async exists(filePath: string): Promise<boolean> {
		return this.lookup(filePath) !== undefined;
	}

	async isFile(filePath: string): Promise<boolean> {
		return this.lookup(filePath)?.type === FileType.File;
	}

	async isDirectory(filePath: string): Promise<boolean> {
		return this.lookup(filePath)?.type === FileType.Directory;
	}

	async readDirectory(filePath: string): Promise<[string, FileType][]> {
		const node = this.lookupOrThrow(filePath);
		if (node.type !== FileType.Directory) {
			throw fileSystemError(
				"ENOTDIR",
				`ENOTDIR: not a directory, scandir '${filePath}'`
			);
		}
		return Array.from((node as DirectoryNode).entries.entries())
			.sort(([a], [b]) => compareStrings(a, b))
			.map(([name, child]): [string, FileType] => [
				name,
				this.leadsBack(filePath, child)
					? FileType.SymbolicLink
					: this.typeOf(child),
			]);
	}

	/** Whether a link to a directory leads back to the directory it is in or one of its ancestors, so nothing descends into it. */
	private leadsBack(dirPath: string, child: Node): boolean {
		if (child.type !== FileType.SymbolicLink) return false;
		if (this.lookup(child.target)?.type !== FileType.Directory)
			return false;
		const real = this.walk(child.target, true).realParts.join("/");
		const parts = splitPath(dirPath);
		for (let length = parts.length; length >= 0; length--) {
			const ancestor = this.walk(parts.slice(0, length).join("/"), true);
			if (ancestor.realParts.join("/") === real) return true;
		}
		return false;
	}

	async createDirectory(filePath: string): Promise<void> {
		const parts = splitPath(filePath);
		const leading = toPosix(filePath).startsWith("/") ? "/" : "";
		let current: Node = this.root;
		let currentPath = "";

		for (const part of parts) {
			currentPath += (currentPath ? "/" : leading) + part;

			let child: Node | undefined = (
				current as DirectoryNode
			).entries.get(part);

			if (!child) {
				child = new DirectoryNode();
				(current as DirectoryNode).entries.set(part, child);
				this.fire({
					type: FileChangeType.ADDED,
					path: currentPath,
					fileType: FileType.Directory,
				});
			}
			const resolved: Node | undefined =
				child.type === FileType.SymbolicLink
					? this.lookup(child.target)
					: child;
			if (resolved?.type !== FileType.Directory) {
				const last = part === parts[parts.length - 1];
				throw last
					? fileSystemError(
							"EEXIST",
							`EEXIST: file already exists, mkdir '${currentPath}'`
						)
					: walkError("ENOTDIR", "mkdir", currentPath);
			}
			current = resolved;
		}
	}

	async readFile(filePath: string): Promise<string> {
		const node = this.lookupOrThrow(filePath);
		if (node.type === FileType.Directory) {
			throw fileSystemError(
				"EISDIR",
				`EISDIR: illegal operation on a directory, read '${filePath}'`
			);
		}
		return (node as FileNode).content;
	}

	async writeFile(filePath: string, content: string): Promise<void> {
		const parts = splitPath(filePath);
		const name = parts.pop()!;
		const leading = toPosix(filePath).startsWith("/") ? "/" : "";
		const dir = leading + parts.join("/");
		if (!(await this.exists(dir))) await this.createDirectory(dir);
		const parent = this.parentOf(filePath);

		const node = parent.entries.get(name);
		if (node?.type === FileType.SymbolicLink) {
			return this.writeFile(node.target, content);
		}
		const type = node ? FileChangeType.UPDATED : FileChangeType.ADDED;

		if (node && node.type === FileType.Directory) {
			throw fileSystemError(
				"EISDIR",
				`EISDIR: illegal operation on a directory, write '${filePath}'`
			);
		}

		parent.entries.set(name, new FileNode(content));
		this.fire({
			type,
			path: this.targetPath(filePath),
			fileType: FileType.File,
		});
	}

	async delete(filePath: string, recursive: boolean = false): Promise<void> {
		const parts = splitPath(filePath);
		const name = parts.pop();
		const { node: parent, failure } = this.walk(parts.join("/"), true);
		if (failure === "ENOTDIR" || parent?.type === FileType.File)
			throw walkError("ENOTDIR", "rm", filePath);
		if (!name || parent?.type !== FileType.Directory) return;
		const target = parent.entries.get(name);
		if (!target) return;

		if (target.type === FileType.Directory && !recursive) {
			throw fileSystemError(
				"EISDIR",
				`EISDIR: illegal operation on a directory, rm '${filePath}'`
			);
		}

		parent.entries.delete(name);

		this.emitDeleted(target, toPosix(filePath));
	}

	async rename(
		source: string,
		destination: string,
		overwrite: boolean = false
	): Promise<void> {
		const from = toPosix(source);
		const to = toPosix(destination);
		if (from === to) return;
		const found = this.walk(source, false);
		if (!found.node) throw walkError(found.failure!, "stat", source);
		const node = found.node;
		if (containsPosix(from, to))
			throw fileSystemError(
				"EINVAL",
				`EINVAL: invalid argument, rename '${source}' -> '${destination}'`
			);

		const existing = this.walk(destination, false).node;
		const refusal = renameRefusal(
			existing?.type,
			overwrite,
			source,
			destination
		);
		if (refusal) throw refusal;

		const target = this.parentOrCreate(destination);
		this.parentOf(source).entries.delete(from.split("/").pop()!);
		target.entries.set(to.split("/").pop()!, node);

		this.emitDeleted(node, from);
		this.emitAdded(
			node,
			to,
			existing ? FileChangeType.UPDATED : FileChangeType.ADDED
		);
	}

	private emitDeleted(
		node: Node,
		currentPath: string,
		chain: readonly Node[] = []
	): void {
		const resolved = this.resolve(node);
		if (!resolved) return;
		if (resolved.type === FileType.Directory && !chain.includes(resolved)) {
			for (const [childName, childNode] of resolved.entries) {
				this.emitDeleted(childNode, `${currentPath}/${childName}`, [
					...chain,
					resolved,
				]);
			}
		}
		this.fire({
			type: FileChangeType.DELETED,
			path: currentPath,
			fileType: resolved.type,
		});
	}

	private emitAdded(
		node: Node,
		currentPath: string,
		type: FileChangeType,
		chain: readonly Node[] = []
	): void {
		const resolved = this.resolve(node);
		if (!resolved) return;
		this.fire({ type, path: currentPath, fileType: resolved.type });
		if (resolved.type === FileType.Directory && !chain.includes(resolved)) {
			for (const [childName, childNode] of resolved.entries) {
				this.emitAdded(
					childNode,
					`${currentPath}/${childName}`,
					FileChangeType.ADDED,
					[...chain, resolved]
				);
			}
		}
	}

	private resolve(node: Node): FileNode | DirectoryNode | undefined {
		if (node.type !== FileType.SymbolicLink) return node;
		const target = this.lookup(node.target);
		return target?.type === FileType.SymbolicLink ? undefined : target;
	}

	private fire(change: FileChange): void {
		const links = this.collectLinks(this.root, "");
		const seen = new Set([splitPath(change.path).join("/")]);
		const pending = [{ change, via: new Set<string>() }];
		const leading = change.path.startsWith("/") ? "/" : "";

		for (const { change: current, via } of pending) {
			const key = splitPath(current.path).join("/");
			for (const link of links) {
				if (
					via.has(link.key) ||
					containsPosix(link.key, key) ||
					!containsPosix(link.targetKey, key)
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

	private collectLinks(
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
				links.push(...this.collectLinks(child, key));
			}
		}
		return links;
	}

	/** A target starting with `.` or `..` is relative to the link's directory; any other is a path from the root. */
	async createSymbolicLink(target: string, linkPath: string): Promise<void> {
		const parent = this.parentOrCreate(linkPath);
		const name = splitPath(linkPath).pop()!;
		if (parent.entries.has(name)) {
			throw fileSystemError(
				"EEXIST",
				`EEXIST: file already exists, symlink '${target}' -> '${linkPath}'`
			);
		}
		const link = new LinkNode(this.absoluteTarget(target, linkPath));
		parent.entries.set(name, link);
		this.emitAdded(link, toPosix(linkPath), FileChangeType.ADDED);
	}
}
