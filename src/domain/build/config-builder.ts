import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-project.js";
import { SyncTool } from "../toolchain/toolchain.js";
import { BuildSummary } from "./build.js";
import { BuildOptions } from "./build-service.js";
import { BuildValidator } from "./build-validator.js";
import { Placement, Placer } from "./placement.js";
import { SyncDirCheck } from "./sync-dir-check.js";
import { TreeAssembler } from "./tree-assembler.js";

/** One config built in memory, which `run` goes on to write. */
export interface BuiltProject {
	/** Where the run writes it. */
	readonly outFile: string;
	readonly tree: RojoTree;
	readonly warnings: readonly Diagnostic[];
	/** What `checkSyncDir` found; empty when it wasn't asked for. */
	readonly syncWarnings: readonly Diagnostic[];
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

	async build(
		config: ResolvedConfig,
		options: BuildOptions = {}
	): Promise<Result<BuiltProject, DiagnosticsError>> {
		const placement = this.place(config);
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
}
