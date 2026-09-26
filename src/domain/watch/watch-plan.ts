import path from "path";
import { isInside } from "../../base/path.js";
import { rootsToIndex } from "../build/build.js";
import { ResolvedConfig } from "../config/config.js";
import { IgnoredPath } from "../../platform/watcher/watcher.js";
import { stagingPattern } from "../output/write-output.js";

export interface WatchPlanConfig extends Pick<
	ResolvedConfig,
	"rootDirs" | "outFile" | "syncDir"
> {
	/** The config file, which names the config in `configsFor`. */
	readonly file: string;
}

export interface WatchPlan {
	/** The dirs to watch and index: every config's root dirs, minus any inside another. */
	readonly roots: readonly string[];
	/** Paths the watcher skips: the files Rogen writes and the dirs Rojo syncs from. */
	readonly ignored: readonly IgnoredPath[];
	/** Every config with a root dir that contains `changePath`, each once. */
	configsFor(changePath: string): readonly string[];
	watches(changePath: string): boolean;
}

function contains(parent: string, child: string): boolean {
	return child === parent || isInside(child, parent);
}

export function createWatchPlan(
	configs: readonly WatchPlanConfig[]
): WatchPlan {
	const claims = configs.map((config) => ({
		file: config.file,
		roots: config.rootDirs.map((dir) => path.resolve(dir)),
	}));
	const roots = rootsToIndex(configs);

	const outFiles = [
		...new Set(configs.map((config) => path.resolve(config.outFile))),
	];
	const ignoredPaths = [
		...new Set([
			...outFiles,
			...configs.flatMap((config) =>
				config.syncDir ? [path.resolve(config.syncDir)] : []
			),
		]),
	].filter((target) => !roots.some((root) => contains(target, root)));
	const ignored = [...ignoredPaths, ...outFiles.map(stagingPattern)];

	return {
		roots,
		ignored,
		configsFor: (changePath) => {
			const target = path.resolve(changePath);
			return claims
				.filter(({ roots: own }) =>
					own.some((root) => contains(root, target))
				)
				.map(({ file }) => file);
		},
		watches: (changePath) => {
			const target = path.resolve(changePath);
			return roots.some((root) => contains(root, target));
		},
	};
}
