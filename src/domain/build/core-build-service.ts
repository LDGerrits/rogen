import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { findOutputClashes } from "../output/find-output-clashes.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import {
	BuildOptions,
	BuildService,
	BuiltProject,
	FileLocation,
} from "./build-service.js";
import { summarizeBuild } from "./summarize-build.js";
import { locateFiles } from "./locate-files.js";
import { assemble, check, checkSync, place } from "./pipeline.js";
import { withPlannedFiles } from "./planned-files.js";
import { RouteDiagnostics } from "./route-diagnostics.js";

export class CoreBuildService implements BuildService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly indexService: IndexService,
		private readonly toolchainService: ToolchainService
	) {}

	checkBuildable(configs: readonly ResolvedConfig[]): Diagnostic[] {
		return [
			...configs
				.filter(({ routes }) => Object.keys(routes).length === 0)
				.map(({ file }) =>
					RouteDiagnostics.noRoutes({ resource: file })
				),
			...findOutputClashes(configs),
		];
	}

	async build(
		config: ResolvedConfig,
		options: BuildOptions = {}
	): Promise<Result<BuiltProject, Diagnostic[]>> {
		await this.indexService.ensureIndexed(config.rootDirs);
		const placed = this.place(this.indexService, config);
		if (placed.isErr()) return placed;
		const built = await assemble(placed.value, this.fileSystemService);
		if (built.isErr()) return built;
		return ok({
			tree: built.value.tree,
			summary: summarizeBuild(built.value),
			warnings: check(built.value),
			syncWarnings: options.checkSyncDir
				? await checkSync(built.value, this.fileSystemService)
				: [],
		});
	}

	async locate(
		config: ResolvedConfig,
		paths?: readonly string[]
	): Promise<Result<FileLocation[], Diagnostic[]>> {
		await this.indexService.ensureIndexed(config.rootDirs);
		const index = paths
			? withPlannedFiles(this.indexService, config.rootDirs, paths)
			: this.indexService;
		return this.place(index, config).map((build) =>
			locateFiles(build, paths)
		);
	}

	private place(index: IndexReader, config: ResolvedConfig) {
		return place(index, config, this.toolchainService.getSyncTools());
	}
}
