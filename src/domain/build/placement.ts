import { groupBy } from "../../base/collections.js";
import { isInside, toPosix } from "../../base/path.js";
import path from "path";
import { FileType } from "../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoFile } from "../rojo/rojo.js";
import { BuildSummary, LeftOut } from "./build.js";
import { BuildTree } from "./build-tree.js";
import { EntryReading, NameReadings } from "./name-readings.js";
import { ScannedRoot, UnclaimedMeta } from "./root-scanner.js";
import { RoutedFile } from "./router.js";
import { SyncLayout } from "./sync-layout.js";
import { InstanceClash } from "./instance-resolver.js";

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

	/** The paths left out for `status`, with why. */
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

/** What a placement is made of, by name, since several parts share a type. */
interface PlacementParts {
	readonly config: ResolvedConfig;
	readonly layout: SyncLayout;
	readonly tree: BuildTree;
	readonly roots: readonly ScannedRoot[];
	readonly readings: NameReadings;
	/** Every node a route sends a file to, in scan order, then the copies of init scripts. */
	readonly routedNodes: readonly RoutedFile[];
	/** Every node a placed file is: one per file, and one more per other node a copied init script is. Every instance path appears once; the last source path wins across roots. */
	readonly nodes: readonly RoutedFile[];
	/** Every path the build leaves out of the tree. */
	readonly leftOut: LeftOutPaths;
	readonly clashes: readonly InstanceClash[];
	/** The routed files the tree displaced, in scan order. */
	readonly displaced: readonly DisplacedFile[];
}

/** A meta file the scan found. */
interface ScannedMetaFile {
	readonly sourcePath: string;
	/** Its path in the source path. */
	readonly relativePath: string;
	readonly file: string;
}

/** Where every scanned file lands, or why it lands nowhere; `where` stops here. */
export class Placement {
	readonly config: ResolvedConfig;
	readonly layout: SyncLayout;
	readonly tree: BuildTree;
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

	/** What the name of `file` says it is. */
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

	/** The other nodes a copied init script is. */
	otherNodesOf(file: RoutedFile): readonly RoutedFile[] {
		return (this.nodesBySource.get(file.entry.source) ?? []).filter(
			(node) => node !== file
		);
	}

	/** The directory Rojo reads an init script through, if it does, since it never reads a file with its init name alone. */
	initDirOf(file: RoutedFile): string | undefined {
		return file.init &&
			new RojoFile(
				path.basename(this.layout.emittedPath(file.entry.source))
			).isInit
			? file.init.sitsIn
			: undefined;
	}

	/** What the index holds in `dir`, which lies in one of the source paths. */
	listing(dir: string): ReadonlyMap<string, FileType> {
		const root = this.roots.find((candidate) =>
			isInside(dir, toPosix(candidate.sourcePath))
		);
		return root?.listing(path.normalize(dir)) ?? new Map();
	}

	/** Meta no file claims, across every source path; computed once. */
	unclaimedMeta(): UnclaimedMeta[] {
		this.unclaimed ??= this.roots.flatMap((root) => root.unclaimedMeta());
		return this.unclaimed;
	}

	/** What the build did, counted for the summary. */
	summary(): BuildSummary {
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
