import path from "path";
import { Result, err, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { InstanceReference } from "../roblox/roblox.js";
import {
	ConfigLocations,
	FileLocation,
	Locations,
	SyncTool,
	missingRoutes,
} from "./build.js";
import { LocateTargets } from "./build-service.js";
import { FileLocator, PlannedFilesIndex } from "./file-locator.js";
import { Placer } from "./placement.js";

/** What `where` asked about: the paths, resolved, and the instances. */
interface Targets {
	readonly paths: readonly string[];
	readonly instances: readonly InstanceReference[];
}

/** Answers `where` for a set of configs over one listing, placing files exactly as a build does. */
export class Locator {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly listing: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {}

	/** Fails when a config declares no routes, naming every such config, or can't be placed. */
	async locate(
		configs: readonly ResolvedConfig[],
		query?: LocateTargets
	): Promise<Result<Locations, DiagnosticsError>> {
		const routeless = configs.flatMap(missingRoutes);
		if (routeless.length > 0) return err(new DiagnosticsError(routeless));

		const targets = await this.classify(query);
		const located: ConfigLocations[] = [];
		for (const config of configs) {
			const locations = this.locateIn(config, targets);
			if (locations.isErr()) return locations;
			located.push(locations.value);
		}
		return ok({
			everyFile:
				targets.paths.length === 0 && targets.instances.length === 0,
			configs: located,
			errors: [],
		});
	}

	private locateIn(
		config: ResolvedConfig,
		{ paths, instances }: Targets
	): Result<ConfigLocations, DiagnosticsError> {
		let files: FileLocation[] = [];
		if (paths.length > 0) {
			const planned = this.locatorOf(
				new PlannedFilesIndex(this.listing, config.rootDirs, paths),
				config
			);
			if (planned.isErr()) return err(planned.error);
			files = planned.value.locate(paths);
			if (instances.length === 0)
				return ok({ config, files, instances: [] });
		}

		// A planned file can move the files that exist, and an instance is only ever made by those.
		const existing = this.locatorOf(this.listing, config);
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

	private locatorOf(
		index: IndexReader,
		config: ResolvedConfig
	): Result<FileLocator, DiagnosticsError> {
		const placement = new Placer(index, config, this.tools).place();
		return placement.isErr()
			? err(new DiagnosticsError(placement.error))
			: ok(new FileLocator(placement.value, index));
	}

	/** An argument is an instance when it reads as one and the working dir holds no entry named like its service. */
	private async classify(query?: LocateTargets): Promise<Targets> {
		const paths: string[] = [];
		const instances: InstanceReference[] = [];
		for (const arg of query?.args ?? []) {
			const reference = InstanceReference.parse(arg);
			if (
				reference &&
				!(await this.fileSystemService.exists(
					path.resolve(query!.cwd, reference.service)
				))
			)
				instances.push(reference);
			else paths.push(path.resolve(query!.cwd, arg));
		}
		return { paths, instances };
	}
}
