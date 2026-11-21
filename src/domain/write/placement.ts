import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { isInside, toPosix } from "../../base/path.js";
import path from "path";
import {
	FileType,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { WriteSummary, LeftOut } from "./write.js";
import { WriteTree } from "./write-tree.js";
import { EntryReading, NameReadings } from "./name-readings.js";
import { ScannedRoot, UnclaimedMeta } from "./root-scanner.js";
import { RoutedFile, RoutedFolder } from "./router.js";
import { CompiledLayout } from "./compiled-layout.js";
import { InstanceClash } from "./instance-resolver.js";

export class LeftOutPaths implements Iterable<[string, LeftOut]> {
	private readonly reasons = new Map<string, LeftOut>();

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

export interface DisplacedFile {
	readonly file: RoutedFile;
	readonly node: readonly string[];
	readonly source: string;
}

interface PlacementParts {
	readonly config: ResolvedConfig;
	readonly layout: CompiledLayout;
	readonly tree: WriteTree;
	readonly roots: readonly ScannedRoot[];
	readonly readings: NameReadings;
	readonly routed: readonly RoutedFile[];
	readonly files: readonly RoutedFile[];
	readonly emptyFolders: readonly RoutedFolder[];
	readonly leftOut: LeftOutPaths;
	readonly clashes: readonly InstanceClash[];
	readonly displaced: readonly DisplacedFile[];
	readonly errors: readonly Diagnostic[];
}

interface ScannedMetaFile {
	readonly sourcePath: string;
	readonly relativePath: string;
	readonly file: string;
}

export class Placement {
	readonly config: ResolvedConfig;
	readonly layout: CompiledLayout;
	readonly tree: WriteTree;
	readonly roots: readonly ScannedRoot[];
	readonly readings: NameReadings;
	readonly emptyFolders: readonly RoutedFolder[];
	readonly leftOut: LeftOutPaths;
	readonly clashes: readonly InstanceClash[];
	readonly displaced: readonly DisplacedFile[];
	readonly errors: readonly Diagnostic[];
	readonly routed: readonly RoutedFile[];
	readonly files: readonly RoutedFile[];
	private unclaimed: UnclaimedMeta[] | undefined;

	constructor(parts: PlacementParts) {
		this.config = parts.config;
		this.layout = parts.layout;
		this.tree = parts.tree;
		this.roots = parts.roots;
		this.readings = parts.readings;
		this.emptyFolders = parts.emptyFolders;
		this.leftOut = parts.leftOut;
		this.clashes = parts.clashes;
		this.displaced = parts.displaced;
		this.errors = parts.errors;
		this.routed = parts.routed;
		this.files = parts.files;
	}

	readingOf(file: RoutedFile): EntryReading {
		return this.readings.entryReading(file.entry.source);
	}

	get metaFiles(): ScannedMetaFile[] {
		return this.roots.flatMap(({ sourcePath, metaFiles }) =>
			metaFiles.map((relativePath) => ({
				sourcePath,
				relativePath,
				file: path.join(sourcePath, relativePath),
			}))
		);
	}

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

	isFolder(source: string): boolean {
		const type = this.roots
			.find((root) => isInside(source, toPosix(root.sourcePath)))
			?.listing(path.normalize(path.posix.dirname(source)))
			.get(path.posix.basename(source));
		return type !== undefined && isDirectoryType(type);
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
