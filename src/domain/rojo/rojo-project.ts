import { isObject } from "../../base/object.js";
import {
	RojoNode,
	RojoPath,
	RojoTree,
	childNodes,
	instanceKey,
	isRojoPath,
	rojoPathTarget,
} from "./rojo-tree.js";

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
}

/**
 * A Rojo project file being edited. The owner decides what an ancestor
 * created on its behalf looks like, so the same model serves Rogen's
 * generated tree and the templates `init` writes.
 */
/** The suffix of a Rojo project file, such as `default.project.json`. */
export const PROJECT_SUFFIX = ".project.json";

export const projectFileName = (stem: string): string =>
	`${stem}${PROJECT_SUFFIX}`;

export class RojoProject<T extends ProjectFile = RojoTree> {
	private readonly project: T;

	constructor(
		project: T,
		private readonly createContainer: ContainerFactory
	) {
		this.project = structuredClone(project);
	}

	/** The live project, not a copy. */
	getTree(): T {
		return this.project;
	}

	/** `undefined` when no node is there, or the path crosses a value that isn't a node. */
	getNode(instancePath: readonly string[]): RojoNode | undefined {
		let current: unknown = this.project.tree;
		for (const segment of instancePath) {
			if (!isObject(current)) return undefined;
			current = current[segment];
		}
		return isObject(current) ? current : undefined;
	}

	/**
	 * Merges `data` into the node at `instancePath`, creating each missing
	 * ancestor with the container factory. A node that gets a `$path` drops
	 * a `Folder` class, since Rojo takes the class from what the path holds.
	 * Throws when an ancestor isn't a node.
	 */
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

	/** Removes each node below the root whose `$path` target matches, with its children, and returns where they were. */
	removeNodes(matches: (target: string) => boolean): string[][] {
		const removed: string[][] = [];
		const visit = (node: RojoNode, instancePath: readonly string[]) => {
			for (const [name, child] of childNodes(node)) {
				const childPath = [...instancePath, name];
				if (
					isRojoPath(child.$path) &&
					matches(rojoPathTarget(child.$path))
				) {
					delete node[name];
					removed.push(childPath);
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
