import { getOwn, isObject, setOwn } from "../../base/objects.js";
import { parse } from "../../base/jsonc.js";
import { Result, err, ok } from "../../base/result.js";
import { instanceKey } from "../roblox/roblox.js";
import { PropertyValues } from "./property-values.js";
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

/**
 * The `$` fields of a node; another `$` key holding an object is a child that
 * Rojo warns of.
 */
export const NODE_FIELDS: ReadonlySet<string> = new Set([
	"$className",
	"$path",
	"$properties",
	"$attributes",
	"$ignoreUnknownInstances",
	"$id",
]);

export function isChildNode(key: string, value: unknown): value is RojoNode {
	return !NODE_FIELDS.has(key) && isObject(value);
}

export function childNodes(node: RojoNode): [string, RojoNode][] {
	return Object.entries(node).filter((entry): entry is [string, RojoNode] =>
		isChildNode(...entry)
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
	syncbackRules?: { ignorePaths?: string[]; createIgnoreDirPaths?: boolean };
}

export type ContainerFactory = (instancePath: readonly string[]) => RojoNode;

export interface MountedPath {
	readonly path: RojoPath;
	readonly instancePath: readonly string[];
}

export interface RemovedMount extends MountedPath {
	readonly settings: Readonly<RojoNode>;
}

export interface ProjectFile {
	readonly tree: RojoNode;
	readonly name?: unknown;
	readonly globIgnorePaths?: unknown;
	readonly syncRules?: unknown;
	readonly emitLegacyScripts?: unknown;
	readonly servePort?: unknown;
	readonly serveAddress?: unknown;
}

export interface ParsedProjectFile extends ProjectFile {
	readonly [key: string]: unknown;
}

/**
 * Services stay bare, since Rojo knows their class; deeper containers are
 * folders.
 */
const plainContainer: ContainerFactory = (instancePath) =>
	instancePath.length === 1 ? {} : { $className: "Folder" };

const PROJECT_SUFFIX = ".project.json";

export const projectFileName = (stem: string): string =>
	`${stem}${PROJECT_SUFFIX}`;

export const isProjectFileName = (fileName: string): boolean =>
	fileName.endsWith(PROJECT_SUFFIX) ||
	fileName.endsWith(`${PROJECT_SUFFIX}c`);

export class RojoProject<T extends ProjectFile = RojoProjectFile> {
	private readonly project: T;

	constructor(
		project: T,
		private readonly createContainer: ContainerFactory = plainContainer
	) {
		this.project = structuredClone(project);
	}

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

	static findNonNode(
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

	static findUnknownField(
		node: RojoNode,
		at: readonly string[]
	): readonly string[] | undefined {
		for (const [key, value] of Object.entries(node)) {
			const here = [...at, key];
			const isField = NODE_FIELDS.has(key);
			const isChild =
				isObject(value) && !RojoProject.findNonNode(value, []);
			if (key.startsWith("$") && !isField && !isChild) return here;
			if (!isObject(value) || isField) continue;
			const inner = RojoProject.findUnknownField(value, here);
			if (inner) return inner;
		}
		return undefined;
	}

	static findReservedKeys(
		node: RojoNode,
		at: readonly string[]
	): (readonly string[])[] {
		return childNodes(node).flatMap(([key, child]) => {
			const here = [...at, key];
			return [
				...(key.startsWith("$") && !RojoProject.findNonNode(child, [])
					? [here]
					: []),
				...RojoProject.findReservedKeys(child, here),
			];
		});
	}

	static findUnreadableValues(
		node: RojoNode,
		at: readonly string[]
	): (readonly string[])[] {
		return Object.entries(node).flatMap(([key, value]) => {
			const here = [...at, key];
			if (key === "$properties" || key === "$attributes")
				return isObject(value)
					? Object.entries(value)
							.filter(
								([, found]) => !PropertyValues.isReadable(found)
							)
							.map(([name]) => [...here, name])
					: [];
			return isChildNode(key, value)
				? RojoProject.findUnreadableValues(value, here)
				: [];
		});
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

	getNode(instancePath: readonly string[]): Readonly<RojoNode> | undefined {
		let current: unknown = this.project.tree;
		for (const segment of instancePath) {
			if (!isObject(current)) return undefined;
			current = getOwn(current, segment);
		}
		return isObject(current) ? current : undefined;
	}

	insertNodeReplacingFolder(
		instancePath: readonly string[],
		data: Partial<RojoNode>
	): void {
		const parent = this.ensureContainer(instancePath.slice(0, -1));
		const leaf = instancePath[instancePath.length - 1];
		const existing = getOwn(parent, leaf);
		const updated: RojoNode = {
			...(isObject(existing) ? existing : {}),
			...data,
		};
		setOwn(parent, leaf, RojoProject.replacingFolder(updated));
	}

	private static replacingFolder(node: RojoNode): RojoNode {
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

	withoutPaths(matches: (target: string) => boolean): T {
		const file = this.getFile();
		const visit = (node: RojoNode, depth: number) => {
			if (isRojoPath(node.$path) && matches(rojoPathTarget(node.$path))) {
				delete node.$path;
				if (node.$className === undefined && depth > 1)
					node.$className = "Folder";
			}
			childNodes(node).forEach(([, child]) => visit(child, depth + 1));
		};
		visit(file.tree, 0);
		return file;
	}

	removeNodes(matches: (target: string) => boolean): RemovedMount[] {
		const removed: RemovedMount[] = [];
		const visit = (node: RojoNode, instancePath: readonly string[]) => {
			for (const [name, child] of childNodes(node)) {
				const childPath = [...instancePath, name];
				if (
					isRojoPath(child.$path) &&
					matches(rojoPathTarget(child.$path))
				) {
					const { $path, ...settings } = child;
					removed.push({
						path: $path,
						instancePath: childPath,
						settings,
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

	ensureContainer(instancePath: readonly string[]): RojoNode {
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
