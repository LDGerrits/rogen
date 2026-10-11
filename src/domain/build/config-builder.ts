import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-project.js";
import { BuildFindings, BuildSummary, SyncTool } from "./build.js";
import { BuildValidator } from "./build-validator.js";
import { MetaReader } from "./meta-reader.js";
import { MissingInstances } from "./missing-instances.js";
import { Placement } from "./placement.js";
import { Placer } from "./placer.js";
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

/** What `examine` found for one config: it assembled, with the warnings the build raises (without the sync dir's), or a meta or assembly error stopped it. */
export type ExaminedConfig =
	| {
			readonly kind: "assembled";
			readonly placement: Placement;
			readonly tree: RojoTree;
			/** The files read to assemble the tree. */
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
	private readonly syncDirCheck: SyncDirCheck;

	constructor(
		fileSystemService: FileReader,
		private readonly index: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {
		this.metaReader = new MetaReader(fileSystemService);
		this.syncDirCheck = new SyncDirCheck(fileSystemService);
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
		const examinedConfig = examined.value;
		if (examinedConfig.kind === "stopped")
			return err(new DiagnosticsError(examinedConfig.errors));
		const { placement, tree, readFiles, warnings } = examinedConfig;
		return ok({
			config,
			tree,
			summary: placement.summary(),
			findings: {
				warnings,
				syncWarnings:
					syncWarnings ?? (await this.syncDirCheck.check(placement)),
			},
			readFiles,
		});
	}

	/** Runs every phase of `build` but the sync dir check, which `locate` has no use for. A meta or assembly error doesn't fail it: the placement stands, and the result is `stopped`. Fails only when the files can't be placed. */
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
			tree: assembly.tree,
			readFiles: meta.files,
			warnings: [
				...meta.warnings,
				...new BuildValidator(assembly).validate(),
				...this.modeWarnings(config, placement.value),
			],
		});
	}

	/** Places `config` in every mode it declares but isn't built in, and warns of what a build there would lose. Rogen reads names only, so every build can check every mode. `active` is where the build placed `config`, whose own gaps are already reported. */
	private modeWarnings(
		config: ResolvedConfig,
		active: Placement
	): Diagnostic[] {
		const others = config.modes.filter((mode) => mode !== config.mode);
		if (others.length === 0) return [];
		const known = new Set(
			new MissingInstances(active).find().map(({ instance }) => instance)
		);
		return others.flatMap((mode) => {
			const view = config.inMode(mode);
			if (!view) return [];
			const placed = this.place(view);
			if (placed.isErr()) {
				return placed.error.map(({ resource, position, message }) =>
					warningDiagnostic(
						"mode.clash",
						{ resource, position },
						`${message} (in mode "${mode}")`
					)
				);
			}
			return new MissingInstances(placed.value).modeDiagnostics(known);
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
