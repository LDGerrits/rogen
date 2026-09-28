import path from "path";
import { isInside, toPosix } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import { applyTags } from "./apply-tags.js";
import { assembleTree } from "./assemble-tree.js";
import { ScannedRoot, scanRootDirs } from "./root-scanner.js";
import { MetaDiagnostics } from "./meta-diagnostics.js";
import { FolderMeta } from "./read-folder-meta.js";
import { RouteDiagnostics } from "./route-diagnostics.js";
import { RoutedFile, routeFiles } from "./route-files.js";
import { findUnclaimedMeta } from "./unclaimed-meta.js";

export interface BuildSummary {
	readonly roots: readonly {
		readonly rootDir: string;
		readonly files: number;
		readonly excluded: number;
		readonly skippedLinks: number;
	}[];
	/** In the order the config declares them. */
	readonly routes: readonly {
		readonly key: string;
		readonly target: string;
		readonly files: number;
	}[];
	/** Files carrying each declared tag: placed when it's on, left out when it's off. */
	readonly tags: readonly {
		readonly tag: string;
		readonly on: boolean;
		readonly files: number;
	}[];
	readonly unrouted: number;
	readonly superseded: number;
}

export interface BuildOutput {
	readonly value: RojoTree;
	readonly warnings: readonly Diagnostic[];
	readonly summary: BuildSummary;
}

/** An error per config whose chain declares no routes, so the caller can refuse before scanning anything. */
export function checkRoutes(
	configs: readonly { file: string; routes: ResolvedConfig["routes"] }[]
): Diagnostic[] {
	return configs
		.filter(({ routes }) => Object.keys(routes).length === 0)
		.map(({ file }) => RouteDiagnostics.noRoutes({ resource: file }));
}

/** Reads only the in-memory `index`, which the caller initialized with `rootsToIndex`, and the `readFolderMeta` result. */
export function build(
	config: ResolvedConfig,
	index: IndexService,
	folderMeta: readonly FolderMeta[]
): Result<BuildOutput, Diagnostic[]> {
	const scan = scanRootDirs(index, {
		rootDirs: config.rootDirs,
		exclude: config.exclude,
	});
	const routing = routeFiles(scan.roots, config);
	if (routing.isErr()) return routing;
	const tagging = applyTags(routing.value.routed, config);
	if (tagging.isErr()) return tagging;

	const sourcePaths = (paths: (root: ScannedRoot) => readonly string[]) =>
		scan.roots.flatMap((root) =>
			paths(root).map((relativePath) =>
				toPosix(path.join(root.rootDir, relativePath))
			)
		);
	const assembly = assembleTree(config, {
		files: tagging.value.files,
		excluded: sourcePaths((root) => root.excluded),
		skippedLinks: sourcePaths((root) => root.skippedLinks),
		pruned: tagging.value.pruned,
		unrouted: routing.value.unrouted,
		superseded: tagging.value.superseded,
		folderMeta,
	});
	if (assembly.isErr()) return assembly;

	const unclaimedMeta = findUnclaimedMeta(index, scan.roots);
	const countOf = (
		files: readonly RoutedFile[],
		has: (file: RoutedFile) => boolean
	) => files.filter(has).length;
	const summary: BuildSummary = {
		roots: scan.roots.map((root) => ({
			rootDir: root.rootDir,
			files: root.entries.length,
			excluded: root.excluded.length,
			skippedLinks: root.skippedLinks.length,
		})),
		routes: Object.entries(config.routes).map(([key, target]) => ({
			key,
			target,
			files: countOf(tagging.value.files, (file) => file.route === key),
		})),
		tags: Object.entries(config.tags).map(([tag, on]) => ({
			tag,
			on,
			files: countOf(routing.value.routed, (file) =>
				file.tags.some((match) => match.tag === tag)
			),
		})),
		unrouted: routing.value.unrouted.length,
		superseded: tagging.value.superseded.length,
	};

	return ok({
		value: assembly.value.value,
		summary,
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
			...routing.value.warnings,
			...tagging.value.warnings,
			...assembly.value.warnings,
		],
	});
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
