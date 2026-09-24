import path from "path";
import { isInside } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import { applyTags } from "./apply-tags.js";
import { scanRootDirs } from "./root-scanner.js";
import { routeFiles } from "./route-files.js";

export interface BuildOutput {
	readonly value: RojoTree;
	readonly warnings: readonly Diagnostic[];
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

	return ok({
		value: {
			name: config.name,
			tree: { $className: "DataModel" },
		},
		warnings: [
			...scan.warnings,
			...routing.value.warnings,
			...tagging.value.warnings,
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
