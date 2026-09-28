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
import { RouteDiagnostics } from "./route-diagnostics.js";
import { routeFiles } from "./route-files.js";
import { findUnclaimedMeta } from "./unclaimed-meta.js";

export interface BuildOutput {
	readonly value: RojoTree;
	readonly warnings: readonly Diagnostic[];
}

/** An error per config whose chain declares no routes, so the caller can refuse before scanning anything. */
export function checkRoutes(
	configs: readonly { file: string; routes: ResolvedConfig["routes"] }[]
): Diagnostic[] {
	return configs
		.filter(({ routes }) => Object.keys(routes).length === 0)
		.map(({ file }) => RouteDiagnostics.noRoutes({ resource: file }));
}

/** Reads only the in-memory `index`, which the caller initialized with `rootsToIndex`. */
export function build(
	config: ResolvedConfig,
	index: IndexService
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
	});

	const unclaimedMeta = findUnclaimedMeta(scan.roots);
	return ok({
		value: assembly.value,
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
			...assembly.warnings,
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
