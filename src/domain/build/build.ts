import path from "path";
import { isInside } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { findOutputClashes } from "../output/find-output-clashes.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import { BuildRecord, LeftOut, TagMatch } from "./build-record.js";
import { FileLocation, locate } from "./locate-files.js";
import { assemble, check, checkSync, place } from "./pipeline.js";
import { RouteDiagnostics } from "./route-diagnostics.js";
export { withPlannedFiles } from "./planned-files.js";
export type { FileLocation } from "./locate-files.js";
export type { RouteMatch } from "./build-record.js";

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
	/** Left out because the template defines their node. */
	readonly displaced: number;
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

/** Builds `config` from the index the caller initialized with `rootsToIndex`, reading only folder meta from `fileSystem`. */
export async function buildProject(
	fileSystem: FileSystemService,
	index: IndexReader,
	config: ResolvedConfig,
	options: BuildOptions = {}
): Promise<Result<BuiltProject, Diagnostic[]>> {
	const placed = place(index, config);
	if (placed.isErr()) return placed;
	const built = await assemble(placed.value, fileSystem);
	if (built.isErr()) return built;
	return ok({
		tree: built.value.tree,
		summary: summarizeBuild(built.value),
		warnings: check(built.value),
		syncWarnings: options.checkSyncDir
			? await checkSync(built.value, fileSystem)
			: [],
	});
}

/** Where each path lands in `config`'s tree, or why it lands nowhere; every scanned path without `paths`. */
export function locateFiles(
	index: IndexReader,
	config: ResolvedConfig,
	paths?: readonly string[]
): Result<FileLocation[], Diagnostic[]> {
	return place(index, config).map((build) => locate(build, paths));
}

function summarizeBuild({
	config,
	roots,
	files,
	leftOut,
}: BuildRecord): BuildSummary {
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
		displaced: countOf("displaced"),
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
