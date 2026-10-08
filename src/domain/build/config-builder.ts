import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-project.js";
import { BuildFindings, BuildSummary, SyncTool } from "./build.js";
import { BuildValidator } from "./build-validator.js";
import { MetaReader } from "./meta-reader.js";
import { ModeCheck } from "./mode-check.js";
import { Placement, Placer } from "./placement.js";
import { SyncDirCheck } from "./sync-dir-check.js";
import { TreeAssembler } from "./tree-assembler.js";

/** One config built in memory, which the run goes on to write. */
export interface BuiltConfig {
	readonly config: ResolvedConfig;
	readonly tree: RojoTree;
	readonly findings: BuildFindings;
	readonly summary: BuildSummary;
	/** The files whose contents the build read, which a change to must rebuild it. */
	readonly readFiles: readonly string[];
}

/** What `examine` found for one config. */
export interface ExaminedConfig {
	readonly placement: Placement;
	/** The tree and the files read to assemble it; absent when a meta or assembly error stopped it. */
	readonly assembled?: {
		readonly tree: RojoTree;
		readonly readFiles: readonly string[];
	};
	/** The errors that stopped assembly, else the warnings the build raises (without the sync dir's). */
	readonly diagnostics: readonly Diagnostic[];
}

/** Builds one config from an index, phase by phase, so `run` and `locate` place files the same way. */
export class ConfigBuilder {
	private readonly metaReader: MetaReader;
	private readonly assembler: TreeAssembler;
	private readonly syncDirCheck: SyncDirCheck;
	private readonly modeCheck: ModeCheck;

	constructor(
		fileSystemService: FileSystemService,
		private readonly index: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {
		this.metaReader = new MetaReader(fileSystemService);
		this.assembler = new TreeAssembler();
		this.syncDirCheck = new SyncDirCheck(fileSystemService);
		this.modeCheck = new ModeCheck(index, tools);
	}

	/** Places `config`'s files; its caller checked that it declares routes. */
	place(config: ResolvedConfig): Result<Placement, Diagnostic[]> {
		return new Placer(this.index, config, this.tools).place();
	}

	/** Builds `config`: `examine`, then the sync dir check, unless `syncWarnings` already says what is known of it. Fails when any phase does. */
	async build(
		config: ResolvedConfig,
		syncWarnings?: readonly Diagnostic[]
	): Promise<Result<BuiltConfig, DiagnosticsError>> {
		const examined = await this.examine(config);
		if (examined.isErr()) return examined;
		const { placement, assembled, diagnostics } = examined.value;
		if (!assembled) return err(new DiagnosticsError(diagnostics));
		return ok({
			config,
			tree: assembled.tree,
			summary: placement.summary(),
			findings: {
				warnings: diagnostics,
				syncWarnings:
					syncWarnings ?? (await this.syncDirCheck.check(placement)),
			},
			readFiles: assembled.readFiles,
		});
	}

	/** Runs every phase of `build` but the sync dir check and the write, which `locate` has no use for. A meta or assembly error doesn't fail it: the placement stands, and the error is in `diagnostics`. Fails only when the files can't be placed. */
	async examine(
		config: ResolvedConfig
	): Promise<Result<ExaminedConfig, DiagnosticsError>> {
		const placement = this.place(config);
		if (placement.isErr())
			return err(new DiagnosticsError(placement.error));
		const assembled = await this.assemble(placement.value);
		if (assembled.isErr())
			return ok({
				placement: placement.value,
				diagnostics: assembled.error,
			});
		const { meta, assembly } = assembled.value;
		return ok({
			placement: placement.value,
			assembled: { tree: assembly.tree, readFiles: meta.files },
			diagnostics: [
				...new BuildValidator(assembly).validate(),
				...this.modeCheck.check(config, placement.value),
			],
		});
	}

	private async assemble(placement: Placement) {
		const meta = await this.metaReader.read(placement);
		if (meta.isErr()) return err(meta.error);
		const assembly = this.assembler.assemble(placement, meta.value);
		return assembly.isErr()
			? err(assembly.error)
			: ok({ meta: meta.value, assembly: assembly.value });
	}
}
