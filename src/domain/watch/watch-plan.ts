import path from "path";
import { contains, outermostDirs } from "../../base/path.js";
import { IgnoredPath } from "../../platform/watcher/watcher.js";
import { OutputFile } from "../build/build.js";
import { SYNCBACK_FILES } from "../config/config.js";
import { ResolvedConfig } from "../config/resolved-config.js";

type WatchPlanConfig = Pick<
	ResolvedConfig,
	"indexedPaths" | "projectFile" | "compiledPath" | "projectDir"
> &
	Partial<Pick<ResolvedConfig, "isAdopted">>;

export class WatchPlan {
	readonly roots: readonly string[];
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
				configs
					.filter((config) => !config.isAdopted)
					.map((config) => path.resolve(config.projectFile))
			),
		].map((projectFile) => new OutputFile(projectFile));
		const ignoredPaths = [
			...new Set([
				...outputs.map(({ path }) => path),
				...configs.flatMap((config) =>
					config.compiledPath
						? [path.resolve(config.compiledPath)]
						: []
				),
				...configs.flatMap(({ projectDir }) =>
					Object.values(SYNCBACK_FILES).map((name) =>
						path.resolve(projectDir, name)
					)
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
