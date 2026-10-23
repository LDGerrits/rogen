import { groupBy } from "../../base/collections.js";
import { isInside, toPosix } from "../../base/path.js";
import path from "path";
import { FileType } from "../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { WriteSummary, LeftOut } from "./write.js";
import { WriteTree } from "./write-tree.js";
import { EntryReading, NameReadings } from "./name-readings.js";
import { ScannedRoot, UnclaimedMeta } from "./root-scanner.js";
import { RoutedFile } from "./router.js";
import { CompiledLayout } from "./compiled-layout.js";
import { InstanceClash } from "./instance-resolver.js";
import { isPlayerScriptContainer } from "../roblox/roblox.js";

/** Why each path is left out of the tree, by absolute POSIX path. */
export class LeftOutPaths implements Iterable<[string, LeftOut]> {
	private readonly reasons = new Map<string, LeftOut>();

	/** A path listed by a later source keeps the later reason. */
	constructor(...sources: Iterable<[string, LeftOut]>[]) {
		for (const source of sources)
			for (const [path, why] of source) this.reasons.set(path, why);
	}

	get(source: string): LeftOut | undefined {
		return this.reasons.get(source);
	}

	[Symbol.iterator](): IterableIterator<[string, LeftOut]> {
		return this.reasons[Symbol.iterator]();
	}

	withStatus<S extends LeftOut["status"]>(
		status: S
	): [string, Extract<LeftOut, { status: S }>][] {
		return [...this.reasons].filter(
			(entry): entry is [string, Extract<LeftOut, { status: S }>] =>
				entry[1].status === status
		);
	}

	count(status: LeftOut["status"]): number {
		return this.withStatus(status).length;
	}
}

/** A routed file the tree displaced: the node the tree defines, and the file or folder that names it. */
export interface DisplacedFile {
	readonly file: RoutedFile;
	readonly node: readonly string[];
	readonly source: string;
}

export interface PlayerClientScripts {
	readonly rulable: ReadonlySet<string>;
	readonly inits: readonly RoutedFile[];
}

interface PlacementParts {
	readonly config: ResolvedConfig;
	readonly layout: CompiledLayout;
	readonly tree: WriteTree;
	readonly roots: readonly ScannedRoot[];
	readonly readings: NameReadings;
	readonly routedNodes: readonly RoutedFile[];
	readonly nodes: readonly RoutedFile[];
	readonly leftOut: LeftOutPaths;
	readonly clashes: readonly InstanceClash[];
	readonly displaced: readonly DisplacedFile[];
}

interface ScannedMetaFile {
	readonly sourcePath: string;
	readonly relativePath: string;
	readonly file: string;
}

/** Where every scanned file lands, or why it lands nowhere; `where` stops here. */
export class Placement {
	readonly config: ResolvedConfig;
	readonly layout: CompiledLayout;
	readonly tree: WriteTree;
	readonly roots: readonly ScannedRoot[];
	readonly readings: NameReadings;
	readonly nodes: readonly RoutedFile[];
	readonly leftOut: LeftOutPaths;
	readonly clashes: readonly InstanceClash[];
	readonly displaced: readonly DisplacedFile[];
	/** As `files`, but every file a route governs, before clashes decide which are placed. */
	readonly routed: readonly RoutedFile[];
	/** One per placed file, at its own node, or at its first copy when a route placed it nowhere itself. */
	readonly files: readonly RoutedFile[];
	private readonly nodesBySource: ReadonlyMap<string, readonly RoutedFile[]>;
	private unclaimed: UnclaimedMeta[] | undefined;
	private legacy: PlayerClientScripts | undefined;

	constructor(parts: PlacementParts) {
		this.config = parts.config;
		this.layout = parts.layout;
		this.tree = parts.tree;
		this.roots = parts.roots;
		this.readings = parts.readings;
		this.nodes = parts.nodes;
		this.leftOut = parts.leftOut;
		this.clashes = parts.clashes;
		this.displaced = parts.displaced;
		this.nodesBySource = groupBy(parts.nodes, ({ entry }) => entry.source);
		this.routed = Placement.onePerFile(
			groupBy(parts.routedNodes, ({ entry }) => entry.source)
		);
		this.files = Placement.onePerFile(this.nodesBySource);
	}

	private static onePerFile(
		bySource: ReadonlyMap<string, readonly RoutedFile[]>
	): RoutedFile[] {
		return [...bySource.values()].map(
			(nodes) =>
				nodes.find(({ routeMatch }) => routeMatch !== "copy") ??
				nodes[0]
		);
	}

	readingOf(file: RoutedFile): EntryReading {
		return this.readings.entryReading(file.entry.source);
	}

	/** Every meta file of every source path, in source path order. */
	get metaFiles(): ScannedMetaFile[] {
		return this.roots.flatMap(({ sourcePath, metaFiles }) =>
			metaFiles.map((relativePath) => ({
				sourcePath,
				relativePath,
				file: path.join(sourcePath, relativePath),
			}))
		);
	}

	otherNodesOf(file: RoutedFile): readonly RoutedFile[] {
		return (this.nodesBySource.get(file.entry.source) ?? []).filter(
			(node) => node !== file
		);
	}

	/** The client scripts in a player scripts container that `emitLegacyScripts: false` would make RunContext scripts: those a sync rule keeps LocalScripts, and the init scripts none can. */
	get playerClientScripts(): PlayerClientScripts {
		if (this.legacy) return this.legacy;
		const rulable = new Set<string>();
		const inits: RoutedFile[] = [];
		const clients = this.tree.disablesLegacyScripts
			? this.nodes.filter(
					(file) =>
						isPlayerScriptContainer(file.instancePath) &&
						file.entry.file.ownRule === undefined &&
						this.readingOf(file).scriptSuffix === "client"
				)
			: [];
		for (const file of clients) {
			if (this.initDirOf(file) !== undefined) inits.push(file);
			else rulable.add(file.entry.source);
		}
		this.legacy = { rulable, inits };
		return this.legacy;
	}

	/** The directory Rojo reads an init script or a default project file through, if it does. */
	initDirOf(file: RoutedFile): string | undefined {
		if (!file.init) return undefined;
		const emitted = new RojoFile(
			path.basename(this.layout.emittedPath(file.entry.source)),
			SyncRules.DEFAULT
		);
		return emitted.isInit || emitted.isDefaultProject
			? file.init.sitsIn
			: undefined;
	}

	listing(dir: string): ReadonlyMap<string, FileType> {
		const root = this.roots.find((candidate) =>
			isInside(dir, toPosix(candidate.sourcePath))
		);
		return root?.listing(path.normalize(dir)) ?? new Map();
	}

	unclaimedMeta(): UnclaimedMeta[] {
		this.unclaimed ??= this.roots.flatMap((root) => root.unclaimedMeta());
		return this.unclaimed;
	}

	summary(): WriteSummary {
		return {
			roots: this.roots.map((root) => ({
				sourcePath: root.sourcePath,
				files: root.entries.length,
				ignored: root.ignoredCount,
				mounted: root.mountedCount,
				skippedLinks: root.skippedCount,
			})),
			routes: [...this.config.routes].map(([key, target]) => ({
				key,
				target: target.toString(),
				files: this.files.filter((file) => file.route === key).length,
			})),
			unrouted: this.leftOut.count("unrouted"),
			replaced: this.leftOut.count("replaced"),
			displaced: this.leftOut.count("displaced"),
		};
	}
}
