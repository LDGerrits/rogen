import path from "path";
import { contains, outermostDirs } from "../../base/path.js";
import { IgnoredPath } from "../../platform/watcher/watcher.js";
import { OutputFile } from "../write/write.js";
import { SYNCBACK_FILES } from "../config/config.js";
import { ResolvedConfig } from "../config/resolved-config.js";

type WatchPlanConfig = Pick<
	ResolvedConfig,
	"indexedPaths" | "projectFile" | "compiledPath" | "projectDir"
> &
	Partial<Pick<ResolvedConfig, "isAdopted">>;

export class WatchPlan {
	readonly roots: readonly string[];
	/** The compiled paths outside every root, watched only to check them again. */
	readonly compiledRoots: readonly string[];
	readonly ignored: readonly IgnoredPath[];
	private readonly claims: readonly {
		readonly projectFile: string;
		readonly roots: readonly string[];
		readonly compiledPath: string | undefined;
	}[];

	constructor(configs: readonly WatchPlanConfig[]) {
		this.claims = configs.map((config) => ({
			projectFile: config.projectFile,
			roots: config.indexedPaths.map((dir) => path.resolve(dir)),
			compiledPath:
				config.compiledPath && path.resolve(config.compiledPath),
		}));
		this.roots = outermostDirs(this.claims.flatMap(({ roots }) => roots));
		const inRoot = (target: string) =>
			this.roots.some((root) => contains(root, target));
		this.compiledRoots = outermostDirs(
			this.claims.flatMap(({ compiledPath }) =>
				compiledPath && !inRoot(compiledPath) ? [compiledPath] : []
			)
		);

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

	/** The projects whose roots hold `changePath`; none for compiled output, which only starts a check. */
	projectsFor(changePath: string): readonly string[] {
		const target = path.resolve(changePath);
		if (this.isCompiled(target)) return [];
		return this.claims
			.filter(({ roots }) => roots.some((root) => contains(root, target)))
			.map(({ projectFile }) => projectFile);
	}

	/** The projects whose compiled path holds `changePath`, unless a root inside that compiled path does. */
	compiledFor(changePath: string): readonly string[] {
		const target = path.resolve(changePath);
		return this.claims
			.filter(
				({ compiledPath }) =>
					compiledPath !== undefined &&
					contains(compiledPath, target) &&
					!this.roots.some(
						(root) =>
							contains(compiledPath, root) &&
							contains(root, target)
					)
			)
			.map(({ projectFile }) => projectFile);
	}

	isCompiled(changePath: string): boolean {
		return this.compiledFor(changePath).length > 0;
	}

	watches(changePath: string): boolean {
		const target = path.resolve(changePath);
		return this.roots.some((root) => contains(root, target));
	}
}
