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
import {
	locateFiles,
	summarizeBuild,
	withPlannedFiles,
} from "./build-report.js";
import { BuildValidator } from "./build-validator.js";
import { findConfigsWithoutRoutes, placeFiles } from "./placement.js";
import { TreeAssembler } from "./tree-assembler.js";

export class CoreBuildService implements BuildService {
	declare readonly _serviceBrand: undefined;

	private readonly assembler: TreeAssembler;
	private readonly validator: BuildValidator;

	constructor(
		fileSystemService: FileSystemService,
		private readonly indexService: IndexService,
		private readonly toolchainService: ToolchainService
	) {
		this.assembler = new TreeAssembler(fileSystemService);
		this.validator = new BuildValidator(fileSystemService);
	}

	checkBuildable(configs: readonly ResolvedConfig[]): Diagnostic[] {
		return [
			...findConfigsWithoutRoutes(configs),
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
		const built = await this.assembler.assemble(placed.value);
		if (built.isErr()) return built;
		return ok({
			tree: built.value.tree,
			summary: summarizeBuild(built.value),
			warnings: this.validator.check(built.value),
			syncWarnings: options.checkSyncDir
				? await this.validator.checkSyncDir(built.value)
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
		return placeFiles(index, config, this.toolchainService.getSyncTools());
	}
}
