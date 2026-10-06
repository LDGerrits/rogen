import path from "path";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigSelection } from "../config/config-service.js";
import { InstanceReference } from "../roblox/roblox.js";
import {
	BuildSet,
	ConfigBuild,
	ConfigLocations,
	FileLocation,
	Locations,
	OutputFile,
	SyncTool,
	missingRoutes,
} from "./build.js";
import { BuildService, LocateTargets } from "./build-service.js";
import { BuiltConfig, ConfigBuilder } from "./config-builder.js";
import { FileLocator, PlannedFilesIndex } from "./file-locator.js";
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
		const located: ConfigLocations[] = [];
		for (const config of configs.value) {
			const routes = missingRoutes(config);
			if (routes.length > 0) return err(new DiagnosticsError(routes));
			const locations = await this.locateIn(config, listing, targets);
			if (locations.isErr()) return locations;
			located.push(locations.value);
		}
		return ok({
			everyFile: (targets?.args.length ?? 0) === 0,
			configs: located,
		});
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

	private async locateIn(
		config: ResolvedConfig,
		listing: IndexReader,
		targets?: LocateTargets
	): Promise<Result<ConfigLocations, DiagnosticsError>> {
		const { paths, instances } = await this.classify(targets);

		let files: FileLocation[] = [];
		if (paths.length > 0) {
			const planned = this.locatorOf(
				new PlannedFilesIndex(listing, config.rootDirs, paths),
				config
			);
			if (planned.isErr()) return err(planned.error);
			files = planned.value.locate(paths);
			if (instances.length === 0)
				return ok({ config, files, instances: [] });
		}

		// A planned file can move the files that exist, and an instance is only ever made by those.
		const existing = this.locatorOf(listing, config);
		if (existing.isErr()) return err(existing.error);
		return ok({
			config,
			files:
				paths.length > 0 || instances.length > 0
					? files
					: existing.value.locate(),
			instances: instances.map((reference) => ({
				reference,
				files: existing.value.locateInstance(reference),
			})),
		});
	}

	private builderOf(index: IndexReader): ConfigBuilder {
		return new ConfigBuilder(this.fileSystemService, index, this.syncTools);
	}

	private locatorOf(
		index: IndexReader,
		config: ResolvedConfig
	): Result<FileLocator, DiagnosticsError> {
		const placement = this.builderOf(index).place(config);
		return placement.isErr()
			? err(new DiagnosticsError(placement.error))
			: ok(new FileLocator(placement.value, index));
	}

	private async classify(
		targets?: LocateTargets
	): Promise<{ paths: string[]; instances: InstanceReference[] }> {
		const paths: string[] = [];
		const instances: InstanceReference[] = [];
		if (!targets) return { paths, instances };
		for (const arg of targets.args) {
			const reference = InstanceReference.parse(arg);
			if (
				reference &&
				!(await this.fileSystemService.exists(
					path.resolve(targets.cwd, reference.service)
				))
			)
				instances.push(reference);
			else paths.push(path.resolve(targets.cwd, arg));
		}
		return { paths, instances };
	}
}
