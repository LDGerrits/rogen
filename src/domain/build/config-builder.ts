import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-project.js";
import { BuildFindings, BuildSummary, SyncTool } from "./build.js";
import { BuildValidator } from "./build-validator.js";
import { Placement, Placer } from "./placement.js";
import { SyncDirCheck } from "./sync-dir-check.js";
import { TreeAssembler } from "./tree-assembler.js";

/** One config built in memory, which the run goes on to write. */
export interface BuiltConfig {
	readonly tree: RojoTree;
	readonly findings: BuildFindings;
	readonly summary: BuildSummary;
	/** The files whose contents the build read, which a change to must rebuild it. */
	readonly readFiles: readonly string[];
}

/** Builds one config from an index, phase by phase, so `run` and `locate` place files the same way. */
export class ConfigBuilder {
	private readonly assembler: TreeAssembler;
	private readonly syncDirCheck: SyncDirCheck;

	constructor(
		fileSystemService: FileSystemService,
		private readonly index: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {
		this.assembler = new TreeAssembler(fileSystemService);
		this.syncDirCheck = new SyncDirCheck(fileSystemService);
	}

	/** Places `config`'s files; its caller checked that it declares routes. */
	place(config: ResolvedConfig): Result<Placement, Diagnostic[]> {
		return new Placer(this.index, config, this.tools).place();
	}

	/** Builds `config`; `syncWarnings` is what is already known of its sync dir, which is checked only when nothing is. */
	async build(
		config: ResolvedConfig,
		syncWarnings?: readonly Diagnostic[]
	): Promise<Result<BuiltConfig, DiagnosticsError>> {
		const placement = this.place(config);
		if (placement.isErr())
			return err(new DiagnosticsError(placement.error));
		const assembly = await this.assembler.assemble(placement.value);
		if (assembly.isErr()) return err(new DiagnosticsError(assembly.error));
		return ok({
			tree: assembly.value.tree,
			summary: placement.value.summary(),
			findings: {
				warnings: new BuildValidator(assembly.value).validate(),
				syncWarnings:
					syncWarnings ??
					(await this.syncDirCheck.check(placement.value)),
			},
			readFiles: assembly.value.readFiles,
		});
	}
}
