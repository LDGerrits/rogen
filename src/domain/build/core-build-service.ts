import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigSelection } from "../config/config-service.js";
import {
	BuildSet,
	ConfigBuild,
	Locations,
	OutputFile,
	SyncTool,
} from "./build.js";
import { BuildService, LocateTargets } from "./build-service.js";
import { BuiltConfig, ConfigBuilder } from "./config-builder.js";
import { Locator } from "./locator.js";
import { OutputWriter } from "./output-writer.js";

export class CoreBuildService implements BuildService {
	declare readonly _serviceBrand: undefined;

	private readonly writer: OutputWriter;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly indexService: IndexService,
		/** What each tool that writes the sync dir tells a build; the build names none of them. */
		private readonly syncTools: readonly SyncTool[]
	) {
		this.writer = new OutputWriter(fileSystemService);
	}

	async build(
		selection: ConfigSelection
	): Promise<Result<ConfigBuild[], DiagnosticsError>> {
		const set = BuildSet.of(selection);
		if (set.isErr()) return set;
		const { configs } = set.value;
		const listing = await this.indexService.list(
			configs.flatMap(({ rootDirs }) => rootDirs)
		);
		return ok(
			await this.run(
				configs.map((config) => ({ config, syncWarnings: undefined })),
				listing
			)
		);
	}

	async rebuild(
		set: BuildSet,
		file: string,
		listing: IndexReader,
		previous?: ConfigBuild
	): Promise<ConfigBuild> {
		const config = set.configOf(file);
		if (!config) throw new Error(`${file} is not in the set.`);
		// The sync dir changes only with the config or its compiler, so an answer for this version still holds.
		const syncWarnings =
			previous?.config === config ? previous.syncWarnings : undefined;
		const blocked = set.blocking(file);
		if (blocked.length > 0)
			return ConfigBuild.failed(config, blocked, {
				warnings: [],
				syncWarnings,
			});
		const [build] = await this.run([{ config, syncWarnings }], listing);
		return build;
	}

	async locate(
		selection: ConfigSelection,
		targets?: LocateTargets
	): Promise<Result<Locations, DiagnosticsError>> {
		const configs = selection.requireValid();
		if (configs.isErr()) return configs;

		const listing = await this.indexService.list(
			configs.value.flatMap(({ rootDirs }) => rootDirs)
		);
		return new Locator(
			this.fileSystemService,
			listing,
			this.syncTools
		).locate(configs.value, targets);
	}

	/** Builds every config from `listing`, then writes them in order. */
	private async run(
		configs: readonly {
			readonly config: ResolvedConfig;
			readonly syncWarnings: readonly Diagnostic[] | undefined;
		}[],
		listing: IndexReader
	): Promise<ConfigBuild[]> {
		const builder = this.builderOf(listing);
		const builds: ConfigBuild[] = [];
		const built: BuiltConfig[] = [];
		for (const { config, syncWarnings } of configs) {
			const result = await builder.build(config, syncWarnings);
			if (result.isErr()) {
				builds.push(
					ConfigBuild.failed(config, result.error.diagnostics, {
						warnings: [],
						syncWarnings,
					})
				);
				continue;
			}
			built.push(result.value);
			builds.push(
				ConfigBuild.built(
					config,
					"notWritten",
					result.value.findings,
					result.value.summary,
					result.value.readFiles
				)
			);
		}
		if (builds.some(({ outcome }) => outcome === "failed")) return builds;

		for (const [index, { tree, findings }] of built.entries()) {
			const { config } = builds[index];
			const written = await this.writer.write(
				new OutputFile(config.outFile),
				tree
			);
			if (written.isErr()) {
				builds[index] = ConfigBuild.failed(
					config,
					written.error.diagnostics,
					findings
				);
				break;
			}
			builds[index] = builds[index].withOutcome(
				written.value ? "wrote" : "unchanged"
			);
		}
		return builds;
	}

	private builderOf(index: IndexReader): ConfigBuilder {
		return new ConfigBuilder(this.fileSystemService, index, this.syncTools);
	}
}
