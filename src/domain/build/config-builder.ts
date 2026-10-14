import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { BuildFindings, BuildSummary, SyncTool } from "./build.js";
import { BuildValidator } from "./build-validator.js";
import { MetaReader } from "./meta-reader.js";
import { Placement } from "./placement.js";
import { Placer } from "./placer.js";
import { SyncPathCheck } from "./sync-path-check.js";
import { TreeAssembler } from "./tree-assembler.js";
import { UnmountedSources } from "./unmounted-sources.js";

/** One config built in memory, which the run goes on to write. */
export interface BuiltConfig {
	readonly config: ResolvedConfig;
	readonly projectFile: RojoProjectFile;
	readonly findings: BuildFindings;
	readonly summary: BuildSummary;
	/** The files whose contents the build read, which a change to must rebuild it. */
	readonly readFiles: readonly string[];
}

/** What `examine` found for one config: it assembled, with the warnings the build raises (without the sync path's), or a meta or assembly error stopped it. */
export type ExaminedConfig =
	| {
			readonly kind: "assembled";
			readonly placement: Placement;
			readonly projectFile: RojoProjectFile;
			/** The files read to assemble the project file. */
			readonly readFiles: readonly string[];
			readonly warnings: readonly Diagnostic[];
	  }
	| {
			readonly kind: "stopped";
			readonly placement: Placement;
			readonly errors: readonly Diagnostic[];
	  };

/** Builds one config from an index, phase by phase, so `build` and `locate` place files the same way. */
export class ConfigBuilder {
	private readonly metaReader: MetaReader;
	private readonly syncPathCheck: SyncPathCheck;

	constructor(
		fileSystemService: FileReader,
		private readonly index: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {
		this.metaReader = new MetaReader(fileSystemService);
		this.syncPathCheck = new SyncPathCheck(fileSystemService);
	}

	/** Places `config`'s files; its caller checked that it declares routes. */
	place(config: ResolvedConfig): Result<Placement, Diagnostic[]> {
		return new Placer(this.index, config, this.tools).place();
	}

	/** Builds `config`: `examine`, then the sync path check, unless `syncWarnings` already says what is known of it. Fails when any phase does. */
	async build(
		config: ResolvedConfig,
		syncWarnings?: readonly Diagnostic[]
	): Promise<Result<BuiltConfig, DiagnosticsError>> {
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
				syncWarnings:
					syncWarnings ?? (await this.syncPathCheck.check(placement)),
			},
			readFiles,
		});
	}

	/** Runs every phase of `build` but the sync path check, which `locate` has no use for. A meta or assembly error doesn't fail it: the placement stands, and the result is `stopped`. Fails only when the files can't be placed. */
	async examine(
		config: ResolvedConfig
	): Promise<Result<ExaminedConfig, DiagnosticsError>> {
		const placement = this.place(config);
		if (placement.isErr())
			return err(new DiagnosticsError(placement.error));
		const assembled = await this.assemble(placement.value);
		if (assembled.isErr())
			return ok({
				kind: "stopped",
				placement: placement.value,
				errors: assembled.error,
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
				...new BuildValidator(assembly).validate(),
				...new UnmountedSources(config, this.index).diagnostics(),
			],
		});
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
