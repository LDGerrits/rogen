import path from "path";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import { scanRootDirs } from "./root-scanner.js";

const PROJECT_FILE_SUFFIX = ".project.json";

export interface BuildOutput {
	readonly value: RojoTree;
	readonly warnings: readonly Diagnostic[];
}

/**
 * Turns a resolved config into a project tree, reading only the in-memory
 * `index`, which the caller has initialized with `rootsToIndex`. Holds no
 * state, so a rebuild in watch is a full call after `index.applyChanges`.
 */
export function build(
	config: ResolvedConfig,
	index: IndexService
): Result<BuildOutput, Diagnostic[]> {
	const { warnings } = scanRootDirs(index, {
		rootDirs: config.rootDirs,
		exclude: config.exclude,
	});

	return ok({
		value: {
			name: path.basename(config.outFile, PROJECT_FILE_SUFFIX),
			tree: { $className: "DataModel" },
		},
		warnings,
	});
}

/**
 * The absolute dirs to index for every config together, with any dir that
 * lies inside another dropped, since the outer one already covers it.
 */
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

function isInside(dir: string, parent: string): boolean {
	const relative = path.relative(parent, dir);
	return (
		relative !== "" &&
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}
