import path from "path";
import { compareStrings } from "../../base/collections.js";
import { containsPosix, toPosix } from "../../base/path.js";
import { FileLocation, PlacedLocation } from "../build/build-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";

/** A routing folder that holds all of one node, so Rojo reads the folder as that node and syncback can write into it. */
export interface Home {
	/** Absolute POSIX path. */
	readonly dir: string;
	/** The instance path of the node the folder is. */
	readonly node: readonly string[];
}

/** How a placed file was routed, which a new file beside it repeats. */
export type Style = "folder" | "suffix" | "marker" | "fallback";

/** A file placed directly under a node, and how: what a new instance there is written like. */
export interface Donor {
	readonly dir: string;
	readonly style: Style;
	/** What the file's name spells after `@`, when it does. */
	readonly spelled?: string;
	/** Absolute POSIX path of the source path it lies in. */
	readonly sourcePath: string;
}

const AT_KEY = /@([A-Za-z][A-Za-z0-9]*)(?=\.|$)/;
const nodeKey = (node: readonly string[]) => node.join("\0");

const isPlaced = (location: FileLocation): location is PlacedLocation =>
	location.status === "placed";

/** What the placed files of one project say about where their instances live on disk. */
export class SyncbackLayout {
	readonly homes: readonly Home[];
	private readonly placed: readonly PlacedLocation[];
	private readonly roots: readonly string[];
	private readonly keys: ResolvedConfig["keys"];

	constructor(
		readonly config: ResolvedConfig,
		private readonly locations: readonly FileLocation[]
	) {
		this.placed = locations.filter(isPlaced);
		this.roots = config.sourcePaths.map(toPosix);
		this.keys = config.keys;
		this.homes = this.findHomes().map((home) => ({
			...home,
			dir: this.synced(home.dir),
		}));
	}

	/** Where Rojo reads the source folder `dir` from: under the sync path when a tool writes the files there. */
	synced(dir: string): string {
		const { syncPath, commonRoot } = this.config;
		if (syncPath === undefined || commonRoot === undefined) return dir;
		return path.posix.join(
			toPosix(syncPath),
			path.posix.relative(toPosix(commonRoot), dir)
		);
	}

	get sourcePaths(): readonly string[] {
		return this.roots;
	}

	/** The files placed directly under `node`, each as the donor of the layout a new sibling is written in. */
	donorsAt(node: readonly string[]): Donor[] {
		const donors: Donor[] = [];
		for (const file of this.placed) {
			if (file.routeMatch === "init" || file.routeMatch === "copy")
				continue;
			if (!SyncbackLayout.sameNode(file.instancePath.slice(0, -1), node))
				continue;
			const sourcePath = this.rootOf(file.source);
			if (!sourcePath) continue;
			donors.push({
				dir: path.posix.dirname(file.source),
				style: file.routeMatch,
				...(file.routeMatch === "suffix" && {
					spelled:
						AT_KEY.exec(path.posix.basename(file.source))?.[1] ??
						file.route,
				}),
				sourcePath,
			});
		}
		return donors;
	}

	/** The routing folder name used for `route` in this project, else the key itself. */
	folderNameFor(route: string): string {
		for (const file of this.placed) {
			if (file.route !== route || file.routeMatch !== "folder") continue;
			const governing = this.governingDir(file);
			if (governing) return path.posix.basename(governing);
		}
		return route;
	}

	private static sameNode(a: readonly string[], b: readonly string[]) {
		return a.length === b.length && a.every((name, at) => name === b[at]);
	}

	private rootOf(source: string): string | undefined {
		return this.roots.find((root) => containsPosix(root, source));
	}

	/** The first folder from the source path down that spells the file's route, as the router meets it. */
	private governingDir(file: PlacedLocation): string | undefined {
		const root = this.rootOf(file.source);
		if (!root) return undefined;
		const segments = path.posix
			.relative(root, path.posix.dirname(file.source))
			.split("/")
			.filter((segment) => segment !== "");
		for (const [at, segment] of segments.entries())
			if (this.keys.resolve(segment) === file.route)
				return path.posix.join(root, ...segments.slice(0, at + 1));
		return undefined;
	}

	private findHomes(): Home[] {
		const candidates = new Map<
			string,
			{ node: readonly string[]; files: PlacedLocation[] }
		>();
		const bad = new Set<string>();

		for (const file of this.placed) {
			if (file.routeMatch !== "folder" || file.hoisted || file.alsoAt)
				continue;
			const dir = this.governingDir(file);
			if (!dir) continue;
			const node = this.nodeOf(file, dir);
			const known = candidates.get(dir);
			if (!node) bad.add(dir);
			else if (!known) candidates.set(dir, { node, files: [file] });
			else if (!SyncbackLayout.sameNode(known.node, node)) bad.add(dir);
			else known.files.push(file);
		}

		for (const [dir, { node, files }] of candidates) {
			const ours = new Set(files);
			const outsiders = this.placed.filter((file) => !ours.has(file));
			if (
				files.some((file) =>
					path.posix.basename(file.source).includes("@")
				) ||
				outsiders.some((file) => containsPosix(dir, file.source)) ||
				outsiders.some((file) =>
					[file.instancePath, ...(file.alsoAt ?? [])].some(
						(instancePath) =>
							instancePath.length >= node.length &&
							SyncbackLayout.sameNode(
								instancePath.slice(0, node.length),
								node
							)
					)
				) ||
				this.locations.some(
					(location) =>
						location.status === "mounted" &&
						containsPosix(dir, location.source)
				)
			)
				bad.add(dir);
		}

		const good = [...candidates]
			.filter(([dir]) => !bad.has(dir))
			.map(([dir, { node }]): Home => ({ dir, node }));
		const clashing = new Set<string>();
		for (const a of good)
			for (const b of good)
				if (
					a !== b &&
					a.node.length <= b.node.length &&
					SyncbackLayout.sameNode(
						a.node,
						b.node.slice(0, a.node.length)
					)
				) {
					clashing.add(a.dir);
					clashing.add(b.dir);
				}
		return good
			.filter(({ dir }) => !clashing.has(dir))
			.sort((a, b) => compareStrings(nodeKey(a.node), nodeKey(b.node)));
	}

	/** The node that the routing folder `dir` is, when the file's instance path is what Rojo makes of its place in the folder. */
	private nodeOf(
		file: PlacedLocation,
		dir: string
	): readonly string[] | undefined {
		const below = path.posix
			.relative(dir, path.posix.dirname(file.source))
			.split("/")
			.filter((segment) => segment !== "");
		const isInit = path.posix.basename(file.source).startsWith("init.");
		if (isInit && below.length === 0) return undefined;
		const taken = isInit ? below.length : below.length + 1;
		const { instancePath } = file;
		const node = instancePath.slice(0, instancePath.length - taken);
		const named = instancePath.slice(
			instancePath.length - taken,
			instancePath.length - (isInit ? 0 : 1)
		);
		return named.length === below.length &&
			named.every((name, at) => name === below[at])
			? node
			: undefined;
	}
}
