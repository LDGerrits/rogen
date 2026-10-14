import path from "path";
import { contains, outermostDirs } from "../../base/path.js";
import { IgnoredPath } from "../../platform/watcher/watcher.js";
import { OutputFile } from "../build/build.js";
import { ResolvedConfig } from "../config/resolved-config.js";

/** The project file names the project in `projectsFor`. */
type WatchPlanConfig = Pick<
	ResolvedConfig,
	"indexedPaths" | "projectFile" | "syncPath"
>;

/** What a watch watches and what it skips, for a set of configs. */
export class WatchPlan {
	/** The dirs to watch and index: every config's source paths, minus any inside another. */
	readonly roots: readonly string[];
	/** Paths the watcher skips: the files Rogen writes and the dirs Rojo syncs from. */
	readonly ignored: readonly IgnoredPath[];
	private readonly claims: readonly {
		readonly projectFile: string;
		readonly roots: readonly string[];
	}[];

	constructor(configs: readonly WatchPlanConfig[]) {
		this.claims = configs.map((config) => ({
			projectFile: config.projectFile,
			roots: config.indexedPaths.map((dir) => path.resolve(dir)),
		}));
		this.roots = outermostDirs(this.claims.flatMap(({ roots }) => roots));

		const outputs = [
			...new Set(
				configs.map((config) => path.resolve(config.projectFile))
			),
		].map((projectFile) => new OutputFile(projectFile));
		const ignoredPaths = [
			...new Set([
				...outputs.map(({ path }) => path),
				...configs.flatMap((config) =>
					config.syncPath ? [path.resolve(config.syncPath)] : []
				),
			]),
		].filter(
			(target) => !this.roots.some((root) => contains(target, root))
		);
		this.ignored = [
			...ignoredPaths,
			...outputs.map(({ stagingPattern }) => stagingPattern),
		];
	}

	/** The project file of every project with a source path that contains `changePath`, each once. */
	projectsFor(changePath: string): readonly string[] {
		const target = path.resolve(changePath);
		return this.claims
			.filter(({ roots }) => roots.some((root) => contains(root, target)))
			.map(({ projectFile }) => projectFile);
	}

	watches(changePath: string): boolean {
		const target = path.resolve(changePath);
		return this.roots.some((root) => contains(root, target));
	}
}
