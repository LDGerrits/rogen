import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { BuildRecord } from "./build-record.js";
import { findOutputClashes } from "../output/find-output-clashes.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import {
	BuildOptions,
	BuildService,
	BuiltProject,
	FileLocation,
} from "./build-service.js";
import { summarizeBuild } from "./reports/summarize-build.js";
import { locateFiles } from "./reports/locate-files.js";
import { assemble, place } from "./pipeline/pipeline.js";
import { findConfigsWithoutRoutes } from "./pipeline/prepare-build.js";
import { RuleRegistry } from "./rules/rule-registry.js";
import { withPlannedFiles } from "./reports/planned-files.js";

export class CoreBuildService implements BuildService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly indexService: IndexService,
		private readonly toolchainService: ToolchainService,
		private readonly ruleRegistry: RuleRegistry
	) {}

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
		const built = await assemble(placed.value, this.fileSystemService);
		if (built.isErr()) return built;
		return ok({
			tree: built.value.tree,
			summary: summarizeBuild(built.value),
			warnings: this.ruleRegistry
				.getRules()
				.flatMap((rule) => rule.check(built.value)),
			syncWarnings: options.checkSyncDir
				? await this.checkSyncDir(built.value)
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

	private async checkSyncDir(build: BuildRecord): Promise<Diagnostic[]> {
		const warnings: Diagnostic[] = [];
		for (const rule of this.ruleRegistry.getSyncDirRules())
			warnings.push(...(await rule.check(build, this.fileSystemService)));
		return warnings;
	}

	private place(index: IndexReader, config: ResolvedConfig) {
		return place(index, config, this.toolchainService.getSyncTools());
	}
}
