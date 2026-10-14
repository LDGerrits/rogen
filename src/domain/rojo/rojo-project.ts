import { getOwn, isObject, setOwn } from "../../base/objects.js";
import { parse } from "../../base/jsonc.js";
import { Result, err, ok } from "../../base/result.js";
import { instanceKey } from "../roblox/roblox.js";
import { SyncRule } from "./sync-rules.js";

export interface OptionalRojoPath {
	readonly optional: string;
}

type RojoPath = string | OptionalRojoPath;

function isRojoPath(value: unknown): value is RojoPath {
	return (
		typeof value === "string" ||
		(isObject(value) && typeof value.optional === "string")
	);
}

export function rojoPathTarget(rojoPath: RojoPath): string {
	return typeof rojoPath === "string" ? rojoPath : rojoPath.optional;
}

export interface RojoNode {
	$className?: string;
	$path?: RojoPath;
	$properties?: Record<string, unknown>;
	$attributes?: Record<string, unknown>;
	$ignoreUnknownInstances?: boolean;
	$id?: string;
	[key: string]: unknown;
}

function childNodes(node: RojoNode): [string, RojoNode][] {
	return Object.entries(node).filter(
		(entry): entry is [string, RojoNode] =>
			!entry[0].startsWith("$") && isObject(entry[1])
	);
}

export interface RojoProjectFile {
	name?: string;
	tree: RojoNode;
	servePort?: number;
	servePlaceIds?: number[];
	placeId?: number;
	gameId?: number;
	serveAddress?: string;
	globIgnorePaths?: string[];
	syncRules?: SyncRule[];
	emitLegacyScripts?: boolean;
}

/** The node to create for a missing ancestor, named by its instance path. */
export type ContainerFactory = (instancePath: readonly string[]) => RojoNode;

export interface MountedPath {
	readonly path: RojoPath;
	/** Where the node sits; the root node is `[]`. */
	readonly instancePath: readonly string[];
}

/** Any project file: Rogen's own output, or one read from disk with fields Rogen doesn't model. */
export interface ProjectFile {
	readonly tree: RojoNode;
	readonly name?: unknown;
	readonly globIgnorePaths?: unknown;
	readonly syncRules?: unknown;
	readonly emitLegacyScripts?: unknown;
	readonly servePort?: unknown;
	readonly servePlaceIds?: unknown;
	readonly serveAddress?: unknown;
}

export interface ParsedProjectFile extends ProjectFile {
	readonly [key: string]: unknown;
}

/** Services stay bare, since Rojo knows their class; deeper containers are folders. */
const plainContainer: ContainerFactory = (instancePath) =>
	instancePath.length === 1 ? {} : { $className: "Folder" };

const PROJECT_SUFFIX = ".project.json";

export const projectFileName = (stem: string): string =>
	`${stem}${PROJECT_SUFFIX}`;

export const stemOfProjectFile = (fileName: string): string | undefined =>
	fileName.endsWith(PROJECT_SUFFIX)
		? fileName.slice(0, -PROJECT_SUFFIX.length)
		: undefined;

/** A Rojo project file being edited; the owner decides what an ancestor created on its behalf looks like. */
export class RojoProject<T extends ProjectFile = RojoProjectFile> {
	private readonly project: T;

	constructor(
		project: T,
		private readonly createContainer: ContainerFactory = plainContainer
	) {
		this.project = structuredClone(project);
	}

	/** A file without a `tree` gets a bare DataModel. */
	static parse(text: string): Result<RojoProject<ParsedProjectFile>, Error> {
		const parsed = parse(text);
		if (parsed.isErr()) return err(parsed.error);
		if (!isObject(parsed.value)) {
			return err(new Error("it must be a JSON object."));
		}
		const tree = parsed.value.tree ?? { $className: "DataModel" };
		if (!isObject(tree))
			return err(new Error("its tree must be an object."));
		const notNode = RojoProject.findNonNode(tree, []);
		if (notNode) {
			return err(
				new Error(`"${instanceKey(notNode)}" must be an object.`)
			);
		}
		return ok(
			new RojoProject<ParsedProjectFile>({ ...parsed.value, tree })
		);
	}

	private static findNonNode(
		node: RojoNode,
		at: readonly string[]
	): readonly string[] | undefined {
		for (const [key, value] of Object.entries(node)) {
			if (key.startsWith("$")) continue;
			const here = [...at, key];
			if (!isObject(value)) return here;
			const inner = RojoProject.findNonNode(value, here);
			if (inner) return inner;
		}
		return undefined;
	}

	get name(): string | undefined {
		const { name } = this.project;
		return typeof name === "string" && name !== "" ? name : undefined;
	}

	get servePort(): number | undefined {
		const { servePort } = this.project;
		return typeof servePort === "number" &&
			Number.isInteger(servePort) &&
			servePort > 0 &&
			servePort < 65536
			? servePort
			: undefined;
	}

	get servePlaceIds(): number[] {
		const { servePlaceIds } = this.project;
		return Array.isArray(servePlaceIds)
			? servePlaceIds.filter(
					(id): id is number => Number.isSafeInteger(id) && id > 0
				)
			: [];
	}

	get serveAddress(): string | undefined {
		const { serveAddress } = this.project;
		return typeof serveAddress === "string" && serveAddress !== ""
			? serveAddress
			: undefined;
	}

	get globIgnorePaths(): string[] {
		const { globIgnorePaths } = this.project;
		return Array.isArray(globIgnorePaths)
			? globIgnorePaths.filter((glob) => typeof glob === "string")
			: [];
	}

	/** The entries of `syncRules` as written, valid or not. */
	get syncRules(): unknown[] {
		const { syncRules } = this.project;
		return Array.isArray(syncRules) ? syncRules : [];
	}

	get emitLegacyScripts(): boolean | undefined {
		const { emitLegacyScripts } = this.project;
		return typeof emitLegacyScripts === "boolean"
			? emitLegacyScripts
			: undefined;
	}

	/** This project's fields with the given tree, globs and sync rules; fields Rogen doesn't model pass through. */
	toFile(parts: {
		readonly tree: RojoNode;
		readonly globIgnorePaths: readonly string[];
		readonly syncRules?: readonly SyncRule[];
	}): RojoProjectFile {
		const {
			globIgnorePaths: _globs,
			syncRules: _rules,
			...fields
		} = this.getFile();
		const file = { ...fields, tree: parts.tree } as RojoProjectFile;
		if (parts.globIgnorePaths.length > 0) {
			file.globIgnorePaths = [...parts.globIgnorePaths];
		}
		if (parts.syncRules && parts.syncRules.length > 0) {
			file.syncRules = [...parts.syncRules];
		}
		return file;
	}

	getFile(): T {
		return structuredClone(this.project);
	}

	/** `undefined` when no node is there, or the path crosses a value that isn't a node. */
	getNode(instancePath: readonly string[]): Readonly<RojoNode> | undefined {
		let current: unknown = this.project.tree;
		for (const segment of instancePath) {
			if (!isObject(current)) return undefined;
			current = getOwn(current, segment);
		}
		return isObject(current) ? current : undefined;
	}

	/** Merges `data` into the node at `instancePath`, creating missing ancestors; a node that gets a `$path` loses a `Folder` class. */
	insertNode(instancePath: readonly string[], data: Partial<RojoNode>): void {
		if (instancePath.length === 0) return;
		const parent = this.ensureNode(instancePath.slice(0, -1));
		const leaf = instancePath[instancePath.length - 1];
		const existing = getOwn(parent, leaf);
		const updated: RojoNode = {
			...(isObject(existing) ? existing : {}),
			...data,
		};
		setOwn(parent, leaf, RojoProject.withoutFolderClass(updated));
	}

	private static withoutFolderClass(node: RojoNode): RojoNode {
		if (!node.$path || node.$className !== "Folder") return node;
		const withoutClass = { ...node };
		delete withoutClass.$className;
		delete withoutClass.$ignoreUnknownInstances;
		return withoutClass;
	}

	mountedPaths(): MountedPath[] {
		const found: MountedPath[] = [];
		const visit = (node: RojoNode, instancePath: readonly string[]) => {
			if (isRojoPath(node.$path))
				found.push({ path: node.$path, instancePath });
			for (const [name, child] of childNodes(node))
				visit(child, [...instancePath, name]);
		};
		visit(this.project.tree, []);
		return found;
	}

	/** Removes each node below the root whose `$path` target matches, with its children, and returns each one's `$path` and where it was. */
	removeNodes(matches: (target: string) => boolean): MountedPath[] {
		const removed: MountedPath[] = [];
		const visit = (node: RojoNode, instancePath: readonly string[]) => {
			for (const [name, child] of childNodes(node)) {
				const childPath = [...instancePath, name];
				if (
					isRojoPath(child.$path) &&
					matches(rojoPathTarget(child.$path))
				) {
					removed.push({
						path: child.$path,
						instancePath: childPath,
					});
					delete node[name];
				} else {
					visit(child, childPath);
				}
			}
		};
		visit(this.project.tree, []);
		return removed;
	}

	/** Adds the `$path` nodes of `additions` this project lacks; a node already there wins and its `$path` is skipped. */
	mergeMissing(additions: RojoProject<ProjectFile>): {
		added: MountedPath[];
		skipped: MountedPath[];
	} {
		const added: MountedPath[] = [];
		const skipped: MountedPath[] = [];
		const pathsBelow = (node: RojoNode, at: readonly string[]) =>
			new RojoProject({ tree: node }).mountedPaths().map((mounted) => ({
				path: mounted.path,
				instancePath: [...at, ...mounted.instancePath],
			}));
		const merge = (
			node: RojoNode,
			from: RojoNode,
			at: readonly string[]
		) => {
			for (const [key, value] of childNodes(from)) {
				const existing = getOwn(node, key);
				const here = [...at, key];
				if (value.$path !== undefined) {
					if (existing === undefined) {
						setOwn(node, key, value);
						added.push(...pathsBelow(value, here));
					} else {
						skipped.push(...pathsBelow(value, here));
					}
				} else if (isObject(existing)) {
					merge(existing, value, here);
				} else if (existing === undefined) {
					const container: RojoNode = value.$className
						? { $className: value.$className }
						: {};
					const before = added.length;
					merge(container, value, here);
					if (added.length > before) setOwn(node, key, container);
				}
			}
		};
		merge(this.project.tree, additions.getFile().tree, []);
		return { added, skipped };
	}

	private ensureNode(instancePath: readonly string[]): RojoNode {
		let current = this.project.tree;
		instancePath.forEach((segment, depth) => {
			const next = getOwn(current, segment);
			if (next === undefined) {
				setOwn(
					current,
					segment,
					this.createContainer(instancePath.slice(0, depth + 1))
				);
			} else if (!isObject(next)) {
				throw new Error(
					`Can't insert below "${instanceKey(instancePath.slice(0, depth + 1))}": it isn't a node.`
				);
			}
			current = getOwn(current, segment) as RojoNode;
		});
		return current;
	}
}
