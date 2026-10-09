import { isObject } from "../../base/objects.js";
import { parse } from "../../base/jsonc.js";
import { Result, err, ok } from "../../base/result.js";

export interface OptionalRojoPath {
	readonly optional: string;
}

export type RojoPath = string | OptionalRojoPath;

function isRojoPath(value: unknown): value is RojoPath {
	return (
		typeof value === "string" ||
		(isObject(value) && typeof value.optional === "string")
	);
}

/** The file or directory a `$path` points at, whichever form it's written in. */
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

const INSTANCE_SEPARATOR = "/";

/** An instance path written as one key, such as `ReplicatedStorage/Shared/Util`. */
export function instanceKey(instancePath: readonly string[]): string {
	return instancePath.join(INSTANCE_SEPARATOR);
}

/** A node's children: every key Rojo reads as an instance name, in file order. */
function childNodes(node: RojoNode): [string, RojoNode][] {
	return Object.entries(node).filter(
		(entry): entry is [string, RojoNode] =>
			!entry[0].startsWith("$") && isObject(entry[1])
	);
}

/** A map keyed by instance path, kept in the order paths were first set. */
export class InstanceMap<V> implements Iterable<[readonly string[], V]> {
	private readonly entries = new Map<
		string,
		{ readonly path: readonly string[]; value: V }
	>();

	get(instancePath: readonly string[]): V | undefined {
		return this.entries.get(instanceKey(instancePath))?.value;
	}

	set(instancePath: readonly string[], value: V): this {
		const key = instanceKey(instancePath);
		const existing = this.entries.get(key);
		if (existing) existing.value = value;
		else this.entries.set(key, { path: instancePath, value });
		return this;
	}

	*values(): IterableIterator<V> {
		for (const { value } of this.entries.values()) yield value;
	}

	*[Symbol.iterator](): IterableIterator<[readonly string[], V]> {
		for (const { path, value } of this.entries.values())
			yield [path, value];
	}
}

export interface RojoTree {
	name: string;
	tree: RojoNode;
	servePort?: number;
	servePlaceIds?: number[];
	placeId?: number;
	gameId?: number;
	serveAddress?: string;
	globIgnorePaths?: string[];
	emitLegacyScripts?: boolean;
}

/** The node to create for a missing ancestor, named by its instance path. */
export type ContainerFactory = (instancePath: readonly string[]) => RojoNode;

export interface MountedPath {
	readonly path: RojoPath;
	/** Where the node sits; the root node is `[]`. */
	readonly instancePath: readonly string[];
}

/** Any project file: Rogen's own output, or a template read from disk with fields Rogen doesn't model. */
export interface ProjectFile {
	readonly tree: RojoNode;
	readonly name?: unknown;
	readonly globIgnorePaths?: unknown;
	readonly emitLegacyScripts?: unknown;
}

/** A project file read from disk, whose other fields pass through untouched. */
export interface ParsedProjectFile extends ProjectFile {
	readonly [key: string]: unknown;
}

/** Services stay bare, since Rojo knows their class; deeper containers are folders. */
const plainContainer: ContainerFactory = (instancePath) =>
	instancePath.length === 1 ? {} : { $className: "Folder" };

/** The suffix of a Rojo project file, such as `default.project.json`. */
export const PROJECT_SUFFIX = ".project.json";

export const projectFileName = (stem: string): string =>
	`${stem}${PROJECT_SUFFIX}`;

/** A Rojo project file being edited; the owner decides what an ancestor created on its behalf looks like. */
export class RojoProject<T extends ProjectFile = RojoTree> {
	private readonly project: T;

	constructor(
		project: T,
		private readonly createContainer: ContainerFactory = plainContainer
	) {
		this.project = structuredClone(project);
	}

	/** A file without a `tree` gets a bare DataModel; it fails when the text, its tree or a node in it isn't an object. */
	static parse(
		text: string,
		createContainer?: ContainerFactory
	): Result<RojoProject<ParsedProjectFile>, Error> {
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
			new RojoProject<ParsedProjectFile>(
				{ ...parsed.value, tree },
				createContainer
			)
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

	/** The project's own name, when it has a non-empty one. */
	get name(): string | undefined {
		const { name } = this.project;
		return typeof name === "string" && name !== "" ? name : undefined;
	}

	/** The port Rojo serves the project on, when the project sets a valid one. */
	get servePort(): number | undefined {
		const { servePort } = this.project as { servePort?: unknown };
		return Number.isInteger(servePort) &&
			(servePort as number) > 0 &&
			(servePort as number) < 65536
			? (servePort as number)
			: undefined;
	}

	/** The address Rojo listens on, when the project sets one. */
	get serveAddress(): string | undefined {
		const { serveAddress } = this.project as { serveAddress?: unknown };
		return typeof serveAddress === "string" && serveAddress !== ""
			? serveAddress
			: undefined;
	}

	/** The `globIgnorePaths` entries that are strings. */
	get globIgnorePaths(): string[] {
		const { globIgnorePaths } = this.project;
		return Array.isArray(globIgnorePaths)
			? globIgnorePaths.filter((glob) => typeof glob === "string")
			: [];
	}

	/** Whether Rojo emits legacy scripts; `undefined` when the project doesn't say. */
	get emitLegacyScripts(): boolean | undefined {
		const { emitLegacyScripts } = this.project;
		return typeof emitLegacyScripts === "boolean"
			? emitLegacyScripts
			: undefined;
	}

	/** A project file with this project's fields and the given name, tree and globs; fields Rogen doesn't model pass through. */
	toFile(parts: {
		readonly name: string;
		readonly tree: RojoNode;
		readonly globIgnorePaths: readonly string[];
	}): RojoTree {
		const { globIgnorePaths: _globs, ...fields } = this.getTree();
		const file = {
			...fields,
			name: parts.name,
			tree: parts.tree,
		} as RojoTree;
		if (parts.globIgnorePaths.length > 0) {
			file.globIgnorePaths = [...parts.globIgnorePaths];
		}
		return file;
	}

	/** A copy, so what the caller does to it can't reach back into the model. */
	getTree(): T {
		return structuredClone(this.project);
	}

	/** `undefined` when no node is there, or the path crosses a value that isn't a node. */
	getNode(instancePath: readonly string[]): Readonly<RojoNode> | undefined {
		let current: unknown = this.project.tree;
		for (const segment of instancePath) {
			if (!isObject(current)) return undefined;
			current = current[segment];
		}
		return isObject(current) ? current : undefined;
	}

	/** Merges `data` into the node at `instancePath`, creating missing ancestors; a node that gets a `$path` drops a `Folder` class. Throws when an ancestor isn't a node. */
	insertNode(instancePath: readonly string[], data: Partial<RojoNode>): void {
		if (instancePath.length === 0) return;
		const parent = this.ensureNode(instancePath.slice(0, -1));
		const leaf = instancePath[instancePath.length - 1];
		const existing = parent[leaf];
		const updated: RojoNode = {
			...(isObject(existing) ? existing : {}),
			...data,
		};
		if (updated.$path && updated.$className === "Folder") {
			delete updated.$className;
			delete updated.$ignoreUnknownInstances;
		}
		parent[leaf] = updated;
	}

	/** Every `$path` in the tree, depth first, the root's included. */
	getPaths(): MountedPath[] {
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

	/** Rewrites the target of every `$path`, keeping whether it is optional. */
	mapPaths(map: (target: string) => string): void {
		const visit = (node: RojoNode) => {
			if (isRojoPath(node.$path)) {
				node.$path =
					typeof node.$path === "string"
						? map(node.$path)
						: { optional: map(node.$path.optional) };
			}
			for (const [, child] of childNodes(node)) visit(child);
		};
		visit(this.project.tree);
	}

	/** Adds the `$path` nodes of `additions` this project lacks; a node already there wins and its `$path` is skipped. */
	mergeMissing(additions: RojoProject<ProjectFile>): {
		added: MountedPath[];
		skipped: MountedPath[];
	} {
		const added: MountedPath[] = [];
		const skipped: MountedPath[] = [];
		const pathsBelow = (node: RojoNode, at: readonly string[]) =>
			new RojoProject({ tree: node }).getPaths().map((mounted) => ({
				path: mounted.path,
				instancePath: [...at, ...mounted.instancePath],
			}));
		const merge = (
			node: RojoNode,
			from: RojoNode,
			at: readonly string[]
		) => {
			for (const [key, value] of childNodes(from)) {
				const existing = node[key];
				const here = [...at, key];
				if (value.$path !== undefined) {
					if (existing === undefined) {
						node[key] = value;
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
					if (added.length > before) node[key] = container;
				}
			}
		};
		merge(this.project.tree, additions.getTree().tree, []);
		return { added, skipped };
	}

	private ensureNode(instancePath: readonly string[]): RojoNode {
		let current = this.project.tree;
		instancePath.forEach((segment, depth) => {
			const next = current[segment];
			if (next === undefined) {
				current[segment] = this.createContainer(
					instancePath.slice(0, depth + 1)
				);
			} else if (!isObject(next)) {
				throw new Error(
					`Can't insert below "${instanceKey(instancePath.slice(0, depth + 1))}": it isn't a node.`
				);
			}
			current = current[segment] as RojoNode;
		});
		return current;
	}
}
