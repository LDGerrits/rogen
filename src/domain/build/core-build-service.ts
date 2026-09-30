import path from "path";
import { groupBy } from "../../base/collections.js";
import { stableStringify } from "../../base/json.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import {
	BuildOptions,
	BuildService,
	BuiltProject,
	FileLocation,
	OutputFile,
	WrittenProject,
} from "./build-service.js";
import { BuildValidator } from "./build-validator.js";
import { FileLocator, PlannedFilesIndex } from "./file-locator.js";
import { Placement, Placer } from "./placement.js";
import { SyncDirCheck } from "./sync-dir-check.js";
import { TreeAssembler } from "./tree-assembler.js";

export class CoreBuildService implements BuildService {
	declare readonly _serviceBrand: undefined;

	private readonly assembler: TreeAssembler;
	private readonly syncDirCheck: SyncDirCheck;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly indexService: IndexService,
		private readonly toolchainService: ToolchainService
	) {
		this.assembler = new TreeAssembler(fileSystemService);
		this.syncDirCheck = new SyncDirCheck(fileSystemService);
	}

	checkBuildable(
		configs: readonly ResolvedConfig[]
	): Result<void, DiagnosticsError> {
		const upfront = [
			...configs.flatMap((config) => this.missingRoutes(config)),
			...this.outputClashes(configs),
		];
		return upfront.length > 0
			? err(new DiagnosticsError(upfront))
			: ok(undefined);
	}

	async build(
		config: ResolvedConfig,
		options: BuildOptions = {}
	): Promise<Result<BuiltProject, DiagnosticsError>> {
		await this.indexService.ensureIndexed(config.rootDirs);
		const placement = this.place(this.indexService, config);
		if (placement.isErr())
			return err(new DiagnosticsError(placement.error));
		const assembly = await this.assembler.assemble(placement.value);
		if (assembly.isErr()) return err(new DiagnosticsError(assembly.error));
		return ok({
			outFile: config.outFile,
			tree: assembly.value.tree,
			summary: placement.value.summary(),
			warnings: new BuildValidator(assembly.value).validate(),
			syncWarnings: options.checkSyncDir
				? await this.syncDirCheck.check(placement.value)
				: [],
			readFiles: assembly.value.readFiles,
		});
	}

	async write(
		project: BuiltProject
	): Promise<Result<WrittenProject, DiagnosticsError>> {
		const { outFile } = project;
		const content = `${stableStringify(project.tree)}\n`;
		const temporary = new OutputFile(outFile).stagingFile();

		const written = await tryWithAsync(async () => {
			if (
				(await this.fileSystemService.isFile(outFile)) &&
				(await this.fileSystemService.readFile(outFile)) === content
			) {
				return false;
			}
			await this.fileSystemService.writeFile(temporary, content);
			await this.fileSystemService.rename(temporary, outFile, true);
			return true;
		});
		if (written.isOk()) return ok({ written: written.value });

		await this.fileSystemService.delete(temporary).catch(() => undefined);
		return err(
			new DiagnosticsError([
				errorDiagnostic(
					"output.writeFailed",
					{ resource: outFile },
					`the project file could not be written: ${written.error.message}`
				),
			])
		);
	}

	async locate(
		config: ResolvedConfig,
		paths?: readonly string[]
	): Promise<Result<FileLocation[], DiagnosticsError>> {
		await this.indexService.ensureIndexed(config.rootDirs);
		const index = paths
			? new PlannedFilesIndex(this.indexService, config.rootDirs, paths)
			: this.indexService;
		const placement = this.place(index, config);
		return placement.isErr()
			? err(new DiagnosticsError(placement.error))
			: ok(new FileLocator(placement.value).locate(paths));
	}

	private place(
		index: IndexReader,
		config: ResolvedConfig
	): Result<Placement, Diagnostic[]> {
		const missing = this.missingRoutes(config);
		if (missing.length > 0) return err(missing);
		return new Placer(
			index,
			config,
			this.toolchainService.getSyncTools()
		).place();
	}

	/** Nothing can be placed without a route. */
	private missingRoutes(config: ResolvedConfig): Diagnostic[] {
		return config.routes.size > 0
			? []
			: [
					errorDiagnostic(
						"route.noRoutes",
						{ resource: config.file },
						'no routes declared, so nothing can be placed.\nAdd a "routes" map — `rogen init` writes a starting set.'
					),
				];
	}

	/** One error per out file that several configs write. */
	private outputClashes(configs: readonly ResolvedConfig[]): Diagnostic[] {
		const byOutFile = groupBy(
			configs,
			({ outFile }) => path.resolve(outFile),
			({ file }) => file
		);

		return [...byOutFile]
			.filter(([, files]) => files.length > 1)
			.map(([outFile, files]) =>
				errorDiagnostic(
					"output.sameOutFile",
					{ resource: outFile },
					`${files.map((file) => `"${path.basename(file)}"`).join(" and ")} write the same file, ${outFile}. Give each its own "outFile".`
				)
			);
	}
}
