import path from "path";
import { Result, err, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigSelection } from "../config/config-service.js";
import { InstanceReference } from "../roblox/roblox.js";
import {
	BuildBlockers,
	ConfigBuild,
	ConfigLocations,
	FileLocation,
	Locations,
	SyncTool,
	failedBuild,
	missingRoutes,
} from "./build.js";
import { BuildOptions, BuildService, LocateTargets } from "./build-service.js";
import { BuiltProject, ConfigBuilder } from "./config-builder.js";
import { FileLocator, PlannedFilesIndex } from "./file-locator.js";
import { OutputWriter } from "./output-writer.js";

function builtAs(
	config: ResolvedConfig,
	project: BuiltProject,
	outcome: "wrote" | "unchanged" | "notWritten"
): ConfigBuild {
	return {
		config,
		outcome,
		warnings: project.warnings,
		syncWarnings: project.syncWarnings,
		errors: [],
		summary: project.summary,
		readFiles: project.readFiles,
	};
}

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
		selection: ConfigSelection,
		options: BuildOptions = {}
	): Promise<Result<ConfigBuild[], DiagnosticsError>> {
		const configs = selection.requireValid();
		if (configs.isErr()) return configs;

		const blockers = new BuildBlockers(configs.value);
		if (blockers.diagnostics.length > 0)
			return err(new DiagnosticsError([...blockers.diagnostics]));
		const listing = await this.indexService.list(
			configs.value.flatMap(({ rootDirs }) => rootDirs)
		);
		return ok(await this.run(configs.value, listing, options));
	}

	async rebuild(
		config: ResolvedConfig,
		listing: IndexReader,
		options: BuildOptions = {}
	): Promise<ConfigBuild> {
		const [build] = await this.run([config], listing, options);
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
		configs: readonly ResolvedConfig[],
		listing: IndexReader,
		options: BuildOptions
	): Promise<ConfigBuild[]> {
		const builder = this.builderOf(listing);
		const built: Result<BuiltProject, DiagnosticsError>[] = [];
		for (const config of configs)
			built.push(await builder.build(config, options));

		const builds = built.map((result, index) =>
			result.isErr()
				? failedBuild(configs[index], result.error.diagnostics)
				: builtAs(configs[index], result.value, "notWritten")
		);
		if (builds.some(({ outcome }) => outcome === "failed")) return builds;

		for (const [index, result] of built.entries()) {
			const project = result.unwrap();
			const written = await this.writer.write(
				project.outFile,
				project.tree
			);
			if (written.isErr()) {
				builds[index] = failedBuild(
					configs[index],
					written.error.diagnostics,
					project
				);
				break;
			}
			builds[index] = builtAs(
				configs[index],
				project,
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
