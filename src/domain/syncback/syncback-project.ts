import path from "path";
import { isObject } from "../../base/objects.js";
import { toPosix } from "../../base/path.js";
import { PlacedLocation } from "../build/build-service.js";
import { RojoNode, RojoProjectFile } from "../rojo/rojo-project.js";
import { Home } from "./syncback-layout.js";

/** Names that are safe to use as a folder name on every system. */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_ .-]*$/;

const childrenOf = (node: RojoNode): [string, RojoNode][] =>
	Object.entries(node).filter(
		(entry): entry is [string, RojoNode] =>
			!entry[0].startsWith("$") && isObject(entry[1])
	);

export interface SyncbackProjectInputs {
	/** The project file a build wrote, which every `$path` in is relative to `dir`. */
	readonly written: RojoProjectFile;
	/** The config's folder, where the temporary project file goes. */
	readonly dir: string;
	/** Where Rojo writes what no folder of the project holds, relative to `dir` and written with `/`. */
	readonly staging: string;
	readonly homes: readonly Home[];
	/** When the project syncs from a folder a tool writes, the file that each node of it comes from. */
	readonly sources?: readonly PlacedLocation[];
}

/** The project file Rojo's syncback runs on: the written one, with a folder for every node that one folder holds, and a staging folder for every container. */
export class SyncbackProject {
	private constructor(
		readonly file: RojoProjectFile,
		/** The nodes that mount a routing folder. */
		readonly mounted: readonly (readonly string[])[],
		/** The nodes that stage what is new: the one at `i` writes into the folder `i` of `staging`. */
		readonly staged: readonly (readonly string[])[]
	) {}

	static of({
		written,
		dir,
		staging,
		homes,
		sources,
	}: SyncbackProjectInputs): SyncbackProject {
		const file = structuredClone(written);
		const tree = file.tree;
		const mounted: string[][] = [];
		for (const home of homes) {
			const node = SyncbackProject.nodeAt(tree, home.node);
			if (!node) continue;
			for (const [name] of childrenOf(node)) delete node[name];
			delete node.$ignoreUnknownInstances;
			if (home.node.length > 1) delete node.$className;
			node.$path = SyncbackProject.relative(dir, home.dir);
			mounted.push([...home.node]);
		}
		if (sources) SyncbackProject.pointAtSources(tree, [], dir, sources);
		const staged: string[][] = [];
		SyncbackProject.stage(tree, [], staging, staged);
		return new SyncbackProject(file, mounted, staged);
	}

	private static relative(dir: string, target: string): string {
		return toPosix(path.relative(dir, target)) || ".";
	}

	private static nodeAt(
		tree: RojoNode,
		node: readonly string[]
	): RojoNode | undefined {
		let at: RojoNode | undefined = tree;
		for (const name of node) {
			const child: unknown = at?.[name];
			at = isObject(child) ? (child as RojoNode) : undefined;
		}
		return at;
	}

	/** Writes the source file of each node a tool's output replaced in the written project. */
	private static pointAtSources(
		node: RojoNode,
		instancePath: readonly string[],
		dir: string,
		sources: readonly PlacedLocation[]
	): void {
		for (const [name, child] of childrenOf(node)) {
			const here = [...instancePath, name];
			const source = sources.find(
				(file) =>
					file.instancePath.length === here.length &&
					file.instancePath.every((part, at) => part === here[at])
			);
			if (source && child.$path !== undefined)
				child.$path = SyncbackProject.relative(dir, source.source);
			SyncbackProject.pointAtSources(child, here, dir, sources);
		}
	}

	private static stage(
		node: RojoNode,
		instancePath: readonly string[],
		staging: string,
		staged: string[][]
	): void {
		for (const [name, child] of childrenOf(node)) {
			const here = [...instancePath, name];
			SyncbackProject.stage(child, here, staging, staged);
			if (
				child.$path !== undefined ||
				child.$properties !== undefined ||
				child.$attributes !== undefined ||
				child.$id !== undefined ||
				(child.$className !== undefined &&
					child.$className !== "Folder" &&
					here.length > 1) ||
				!here.every((part) => SAFE_NAME.test(part))
			)
				continue;
			child.$path = path.posix.join(staging, String(staged.length));
			staged.push(here);
		}
	}
}
