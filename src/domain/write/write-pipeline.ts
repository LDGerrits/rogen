import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
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

/** One config prepared in memory, which the run goes on to write. */
export interface PreparedConfig {
	readonly config: ResolvedConfig;
	readonly projectFile: RojoProjectFile;
	readonly findings: WriteFindings;
	readonly summary: WriteSummary;
	/** The files the write read; a change to one must rewrite it. */
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
	  };

/** Runs the phases of a write on one config from an index, so `write` and `locate` place files the same way. */
export class WritePipeline {
	private readonly metaReader: MetaReader;
	private readonly projectNames: NestedProjectNames;
	private readonly compiledPathCheck: CompiledPathCheck;
	private readonly mountClashes: MountClashes;

	constructor(
		fileSystemService: FileReader,
		private readonly index: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {
		this.metaReader = new MetaReader(fileSystemService);
		this.projectNames = new NestedProjectNames(fileSystemService, index);
		this.compiledPathCheck = new CompiledPathCheck(fileSystemService);
		this.mountClashes = new MountClashes(fileSystemService);
	}

	/** Places `config`'s files; its caller checked that it declares routes. */
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

	/** What the compiled path check finds for `config` now; unknown when its files can't be placed. */
	async compiledPathWarnings(config: ResolvedConfig): Promise<SyncWarnings> {
		const placement = await this.place(config);
		return placement.isOk()
			? SyncWarnings.known(
					await this.compiledPathCheck.check(placement.value)
				)
			: SyncWarnings.unknown;
	}

	/** Prepares `config`: `examine`, then the compiled path check while `sync` is unknown. Fails when any phase does, or when no source path of the config exists. */
	async run(
		config: ResolvedConfig,
		sync: SyncWarnings = SyncWarnings.unknown
	): Promise<Result<PreparedConfig, DiagnosticsError>> {
		const examined = await this.examine(config);
		if (examined.isErr()) return examined;
		const examinedConfig = examined.value;
		if (examinedConfig.kind === "stopped")
			return err(new DiagnosticsError(examinedConfig.errors));
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

	/** Runs every phase of `run` but the compiled path check. A meta or assembly error, or no source path that exists, doesn't fail it; the result is `stopped`. Fails only when the files can't be placed. */
	async examine(
		config: ResolvedConfig
	): Promise<Result<ExaminedConfig, DiagnosticsError>> {
		const placement = await this.place(config);
		if (placement.isErr())
			return err(new DiagnosticsError(placement.error));
		const assembled = await this.assemble(placement.value);
		if (assembled.isErr())
			return ok({
				kind: "stopped",
				placement: placement.value,
				errors: assembled.error,
			});
		const missing = WritePipeline.missingOf(config, placement.value);
		if (missing.stopsWrite)
			return ok({
				kind: "stopped",
				placement: placement.value,
				errors: missing.diagnostics(),
			});
		const { meta, assembly } = assembled.value;
		return ok({
			kind: "assembled",
			placement: placement.value,
			projectFile: assembly.projectFile,
			readFiles: meta.files,
			warnings: [
				...config.warnings,
				...meta.warnings,
				...new WriteValidator(assembly).validate(),
				...(await this.mountClashes.diagnostics(placement.value)),
				...new UnmountedSources(config, this.index).diagnostics(),
			],
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

	/** The project file a write of `config` would write, or none when it fails. */
	async projectFileOf(
		config: ResolvedConfig
	): Promise<RojoProjectFile | undefined> {
		const examined = await this.examine(config);
		return examined.isOk() && examined.value.kind === "assembled"
			? examined.value.projectFile
			: undefined;
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
