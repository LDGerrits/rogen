import path from "path";
import { isInside } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { findOutputClashes } from "../output/find-output-clashes.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import { assembleTree } from "./assemble-tree.js";
import { checkSyncDir } from "./check-sync-dir.js";
import { checkSyncMeta } from "./check-sync-meta.js";
import { syncLayoutOf } from "./sync-path.js";
import { LeftOut } from "./left-out.js";
import { FileLocation, locate } from "./locate-files.js";
import { MetaDiagnostics } from "./meta-diagnostics.js";
import { readFolderMeta } from "./read-folder-meta.js";
import { Placement, placeFiles } from "./place-files.js";
import { ScanResult, scanRootDirs } from "./root-scanner.js";
import { RouteDiagnostics } from "./route-diagnostics.js";
import { TagMatch } from "./route-files.js";
export { withPlannedFiles } from "./planned-files.js";
export type { FileLocation } from "./locate-files.js";
export type { RouteMatch } from "./route-files.js";
import { findUnclaimedMeta } from "./unclaimed-meta.js";

export interface RootSummary {
	readonly rootDir: string;
	readonly files: number;
	readonly excluded: number;
	readonly skippedLinks: number;
}

export interface RouteSummary {
	readonly key: string;
	readonly target: string;
	readonly files: number;
}

export interface TagSummary {
	readonly tag: string;
	readonly on: boolean;
	/** Files placed with the tag when it's on, or left out by it when it's off. */
	readonly files: number;
}

export interface BuildSummary {
	readonly roots: readonly RootSummary[];
	/** In the order the config declares them. */
	readonly routes: readonly RouteSummary[];
	readonly tags: readonly TagSummary[];
	readonly unrouted: number;
	readonly superseded: number;
}

export interface BuildOptions {
	/**
	 * Also check that the sync dir holds the compiler's output for every root
	 * dir and meta file. That only changes when the compiler runs, so a watch
	 * checks it when a config loads rather than on every rebuild.
	 */
	readonly checkSyncDir?: boolean;
}

/** One config built in memory; writing it is the caller's step. */
export interface BuiltProject {
	readonly tree: RojoTree;
	readonly warnings: readonly Diagnostic[];
	/** What `checkSyncDir` found; empty when it wasn't asked for. */
	readonly syncWarnings: readonly Diagnostic[];
	readonly summary: BuildSummary;
}

/** What must hold across the configs before any is built: each declares routes, and no two write one file. */
export function checkBuildable(
	configs: readonly ResolvedConfig[]
): Diagnostic[] {
	return [
		...configs
			.filter(({ routes }) => Object.keys(routes).length === 0)
			.map(({ file }) => RouteDiagnostics.noRoutes({ resource: file })),
		...findOutputClashes(configs),
	];
}

/**
 * Builds `config` from the in-memory `index`, which the caller initialized
 * with `rootsToIndex`, reading only the folder meta from `fileSystem`. The
 * root dirs are scanned once, and every stage reads that scan.
 */
export async function buildProject(
	fileSystem: FileSystemService,
	index: IndexReader,
	config: ResolvedConfig,
	options: BuildOptions = {}
): Promise<Result<BuiltProject, Diagnostic[]>> {
	const scanned = scanAndPlace(index, config);
	if (scanned.isErr()) return scanned;
	const { scan, placement } = scanned.value;
	const folderMeta = await readFolderMeta(fileSystem, scan.roots);
	if (folderMeta.isErr()) return folderMeta;

	const layout = syncLayoutOf(config);
	const assembly = assembleTree(config, layout, {
		files: placement.files,
		leftOut: placement.leftOut,
		folderMeta: folderMeta.value,
	});
	if (assembly.isErr()) return assembly;

	const unclaimedMeta = findUnclaimedMeta(index, scan.roots);
	const syncWarnings = options.checkSyncDir
		? [
				...(await checkSyncDir(fileSystem, config.rootDirs, layout)),
				...(await checkSyncMeta(
					fileSystem,
					config,
					layout,
					scan.roots,
					new Set(unclaimedMeta.map(({ path }) => path))
				)),
			]
		: [];

	return ok({
		tree: assembly.value.value,
		summary: summarizeBuild(config, placement),
		warnings: [
			...scan.warnings,
			...(unclaimedMeta.length > 0
				? [
						MetaDiagnostics.unclaimed(
							{ resource: config.outFile },
							unclaimedMeta
						),
					]
				: []),
			...placement.warnings,
			...assembly.value.warnings,
		],
		syncWarnings,
	});
}

/** Where each path lands in `config`'s tree, or why it lands nowhere; every scanned path without `paths`. */
export function locateFiles(
	index: IndexReader,
	config: ResolvedConfig,
	paths?: readonly string[]
): Result<FileLocation[], Diagnostic[]> {
	const scanned = scanAndPlace(index, config);
	if (scanned.isErr()) return scanned;
	return ok(locate(index, scanned.value.placement, paths));
}

/** The front of every build, and of every question about one. */
function scanAndPlace(
	index: IndexReader,
	config: ResolvedConfig
): Result<{ scan: ScanResult; placement: Placement }, Diagnostic[]> {
	if (Object.keys(config.routes).length === 0) {
		return err([RouteDiagnostics.noRoutes({ resource: config.file })]);
	}
	const scan = scanRootDirs(index, config);
	const placed = placeFiles(scan.roots, config);
	if (placed.isErr()) return placed;
	return ok({ scan, placement: placed.value });
}

function summarizeBuild(
	config: Pick<ResolvedConfig, "routes" | "tags">,
	{ roots, files, leftOut }: Placement
): BuildSummary {
	const countOf = (
		status: LeftOut["status"],
		paths: Iterable<LeftOut> = leftOut.values()
	) => [...paths].filter((why) => why.status === status).length;
	const carrying = (tag: string, tagSets: readonly (readonly TagMatch[])[]) =>
		tagSets.filter((tags) => tags.some((match) => match.tag === tag))
			.length;
	const placedTags = files.map((file) => file.tags);
	const prunedTags = [...leftOut.values()].flatMap((why) =>
		why.status === "pruned" ? [why.tags] : []
	);
	return {
		roots: roots.map((root) => ({
			rootDir: root.rootDir,
			files: root.entries.length,
			excluded: countOf("excluded", root.leftOut.values()),
			skippedLinks: countOf("skipped", root.leftOut.values()),
		})),
		routes: Object.entries(config.routes).map(([key, target]) => ({
			key,
			target,
			files: files.filter((file) => file.route === key).length,
		})),
		// Every routed file with an off tag was pruned, so off tags count those.
		tags: Object.entries(config.tags).map(([tag, on]) => ({
			tag,
			on,
			files: carrying(tag, on ? placedTags : prunedTags),
		})),
		unrouted: countOf("unrouted"),
		superseded: countOf("replaced"),
	};
}

/** The absolute dirs to index for all configs, minus any dir inside another. */
export function rootsToIndex(
	configs: readonly Pick<ResolvedConfig, "rootDirs">[]
): string[] {
	const dirs = [
		...new Set(
			configs.flatMap((config) =>
				config.rootDirs.map((dir) => path.resolve(dir))
			)
		),
	];
	return dirs.filter(
		(dir) => !dirs.some((other) => other !== dir && isInside(dir, other))
	);
}
