import path from "path";
import { contains, outermostDirs } from "../../base/path.js";
import { IgnoredPath } from "../../platform/watcher/watcher.js";
import { OutputFile } from "../build/build-service.js";
import { ResolvedConfig } from "../config/config.js";

/** `file` names the config in `configsFor`. */
export type WatchPlanConfig = Pick<
	ResolvedConfig,
	"file" | "rootDirs" | "outFile" | "syncDir"
>;

/** What a watch watches and what it skips, for a set of configs. */
export class WatchPlan {
	/** The dirs to watch and index: every config's root dirs, minus any inside another. */
	readonly roots: readonly string[];
	/** Paths the watcher skips: the files Rogen writes and the dirs Rojo syncs from. */
	readonly ignored: readonly IgnoredPath[];
	private readonly claims: readonly {
		readonly file: string;
		readonly roots: readonly string[];
	}[];

	constructor(configs: readonly WatchPlanConfig[]) {
		this.claims = configs.map((config) => ({
			file: config.file,
			roots: config.rootDirs.map((dir) => path.resolve(dir)),
		}));
		this.roots = outermostDirs(this.claims.flatMap(({ roots }) => roots));

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
		].filter(
			(target) => !this.roots.some((root) => contains(target, root))
		);
		this.ignored = [
			...ignoredPaths,
			...outFiles.map(
				(outFile) => new OutputFile(outFile).stagingPattern
			),
		];
	}

	/** Every config with a root dir that contains `changePath`, each once. */
	configsFor(changePath: string): readonly string[] {
		const target = path.resolve(changePath);
		return this.claims
			.filter(({ roots }) => roots.some((root) => contains(root, target)))
			.map(({ file }) => file);
	}

	watches(changePath: string): boolean {
		const target = path.resolve(changePath);
		return this.roots.some((root) => contains(root, target));
	}
}
