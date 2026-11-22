import { Result, err, ok } from "../../base/result.js";
import { Diagnostic, isError } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { SyncTool } from "../toolchain/toolchain.js";
import { SyncWarnings, WriteFindings, WriteSummary } from "./write.js";
import { WriteValidator } from "./check/write-validator.js";
import { MissingSourcePaths } from "./check/missing-source-paths.js";
import { MountClashes } from "./check/mount-clashes.js";
import { MetaReader } from "./meta-reader.js";
import { NestedProjectNames } from "./nested-project-names.js";
import { Placement } from "./placement.js";
import { Placer } from "./placer.js";
import { CompiledPathCheck } from "./check/compiled-path-check.js";
import { TreeAssembler } from "./tree-assembler.js";
import { UnmountedSources } from "./check/unmounted-sources.js";
import { Placeholder } from "./compiled-layout.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";

export interface PreparedConfig {
	readonly config: ResolvedConfig;
	readonly projectFile: RojoProjectFile;
	readonly findings: WriteFindings;
	readonly summary: WriteSummary;
	readonly readFiles: readonly string[];
	readonly placeholders: readonly Placeholder[];
}

type ExaminedConfig =
	| {
			readonly kind: "assembled";
			readonly placement: Placement;
			readonly projectFile: RojoProjectFile;
			readonly readFiles: readonly string[];
			readonly warnings: readonly Diagnostic[];
	  }
	| {
			readonly kind: "stopped";
			readonly placement: Placement;
			readonly errors: readonly Diagnostic[];
			readonly warnings: readonly Diagnostic[];
	  };

export class WritePipeline {
	private readonly metaReader: MetaReader;
	private readonly projectNames: NestedProjectNames;
	private readonly compiledPathCheck: CompiledPathCheck;
	private readonly mountClashes: MountClashes;

	constructor(
		private readonly index: IndexReader,
		private readonly tools: readonly SyncTool[],
		@InstantiationService instantiationService: InstantiationService
	) {
		this.metaReader = instantiationService.createInstance(MetaReader);
		this.projectNames = instantiationService.createInstance(
			NestedProjectNames,
			index
		);
		this.compiledPathCheck =
			instantiationService.createInstance(CompiledPathCheck);
		this.mountClashes = instantiationService.createInstance(MountClashes);
	}

	async place(
		config: ResolvedConfig
	): Promise<Result<Placement, Diagnostic[]>> {
		return new Placer(
			this.index,
			config,
			this.tools,
			await this.projectNames.of(config)
		).place();
	}

	async compiledPathWarnings(config: ResolvedConfig): Promise<SyncWarnings> {
		const placement = await this.place(config);
		return placement.isOk()
			? SyncWarnings.known(
					await this.compiledPathCheck.check(placement.value)
				)
			: SyncWarnings.unknown;
	}

	async run(
		config: ResolvedConfig,
		sync: SyncWarnings = SyncWarnings.unknown
	): Promise<Result<PreparedConfig, DiagnosticsError>> {
		const examined = await this.examine(config);
		if (examined.isErr()) return examined;
		const examinedConfig = examined.value;
		if (examinedConfig.kind === "stopped")
			return err(
				new DiagnosticsError([
					...examinedConfig.errors,
					...examinedConfig.warnings,
				])
			);
		const { placement, projectFile, readFiles, warnings } = examinedConfig;
		return ok({
			config,
			projectFile,
			summary: placement.summary(),
			findings: {
				warnings,
				sync:
					sync.kind === "unknown"
						? SyncWarnings.known(
								await this.compiledPathCheck.check(placement)
							)
						: sync,
			},
			readFiles,
			placeholders: placement.layout.placeholdersOf(
				projectFile,
				(source) => placement.isFolder(source)
			),
		});
	}

	async examine(
		config: ResolvedConfig
	): Promise<Result<ExaminedConfig, DiagnosticsError>> {
		const placement = await this.place(config);
		if (placement.isErr())
			return err(new DiagnosticsError(placement.error));
		const { errors } = placement.value;
		const assembled = await this.assemble(placement.value);
		if (assembled.isErr())
			return ok({
				kind: "stopped",
				placement: placement.value,
				errors: [...errors, ...assembled.error],
				warnings: [],
			});
		const missing = WritePipeline.missingOf(config, placement.value);
		if (missing.stopsWrite)
			return ok({
				kind: "stopped",
				placement: placement.value,
				errors: [...errors, ...missing.errors()],
				warnings: [],
			});
		const { meta, assembly } = assembled.value;
		const raised = [
			...config.warnings,
			...meta.warnings,
			...new WriteValidator(assembly).validate(),
			...(await this.mountClashes.diagnostics(placement.value)),
			...new UnmountedSources(config, this.index).diagnostics(),
		];
		const warnings = raised.filter((diagnostic) => !isError(diagnostic));
		const stopping = [...errors, ...raised.filter(isError)];
		if (stopping.length > 0)
			return ok({
				kind: "stopped",
				placement: placement.value,
				errors: stopping,
				warnings,
			});
		return ok({
			kind: "assembled",
			placement: placement.value,
			projectFile: assembly.projectFile,
			readFiles: meta.files,
			warnings,
		});
	}

	private static missingOf(
		config: ResolvedConfig,
		placement: Placement
	): MissingSourcePaths {
		return new MissingSourcePaths(
			placement.roots,
			config.projectFile,
			config.usesDefaultSourcePath
		);
	}

	private async assemble(placement: Placement) {
		const meta = await this.metaReader.read(placement);
		if (meta.isErr()) return err(meta.error);
		const assembly = new TreeAssembler(placement, meta.value).assemble();
		return assembly.isErr()
			? err(assembly.error)
			: ok({ meta: meta.value, assembly: assembly.value });
	}
}
