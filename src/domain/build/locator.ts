import path from "path";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
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
import { ConfigBuilder } from "./config-builder.js";
import { FileLocator, PlannedFilesIndex } from "./file-locator.js";

/** What `where` asked about: the paths, resolved, and the instances. */
interface Targets {
	readonly paths: readonly string[];
	/** The resolved paths among `paths` that the argument named as a folder, by a trailing separator. */
	readonly folders: ReadonlySet<string>;
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
			const locations = await this.locateIn(config, targets);
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

	private async locateIn(
		config: ResolvedConfig,
		{ paths, folders, instances }: Targets
	): Promise<Result<ConfigLocations, DiagnosticsError>> {
		let files: FileLocation[] = [];
		let diagnostics: readonly Diagnostic[] = [];
		if (paths.length > 0) {
			const index = new PlannedFilesIndex(
				this.listing,
				config.rootDirs,
				paths
			);
			const planned = await this.locatorOf(
				index,
				config,
				await this.existence(index, paths)
			);
			if (planned.isErr()) return err(planned.error);
			files = planned.value.locator.locate(paths, folders);
			diagnostics = planned.value.diagnostics;
			if (instances.length === 0)
				return ok({ config, files, instances: [], diagnostics });
		}

		// A planned file can move the files that exist, and an instance is only ever made by those.
		const existing = await this.locatorOf(this.listing, config);
		if (existing.isErr()) return err(existing.error);
		const { locator } = existing.value;
		return ok({
			config,
			files:
				paths.length > 0 || instances.length > 0
					? files
					: locator.locate(),
			instances: instances.map((reference) => ({
				reference,
				files: locator.locateInstance(reference),
			})),
			diagnostics:
				paths.length > 0 ? diagnostics : existing.value.diagnostics,
		});
	}

	/** Places `config` over `index` through the builder, so `where` places files as `build` does. */
	private async locatorOf(
		index: IndexReader,
		config: ResolvedConfig,
		exists?: (source: string) => boolean
	): Promise<
		Result<
			{
				readonly locator: FileLocator;
				readonly diagnostics: readonly Diagnostic[];
			},
			DiagnosticsError
		>
	> {
		const examined = await new ConfigBuilder(
			this.fileSystemService,
			index,
			this.tools
		).examine(config);
		return examined.map(({ placement, diagnostics }) => ({
			locator: new FileLocator(placement, index, exists),
			diagnostics,
		}));
	}

	/** Whether each of `paths` is there now: not one the index only plans, and in the listing or on disk. Any other path the locator names is a file the scan found. */
	private async existence(
		index: PlannedFilesIndex,
		paths: readonly string[]
	): Promise<(source: string) => boolean> {
		const known = new Map<string, boolean>();
		for (const target of paths) {
			known.set(
				toPosix(target),
				!index.isPlanned(target) &&
					(this.listing.hasEntry(
						path.dirname(target),
						path.basename(target)
					) ||
						(await this.fileSystemService.exists(target)))
			);
		}
		return (source) => known.get(source) ?? !index.isPlanned(source);
	}

	/** An argument is an instance when it reads as one and the working dir holds no entry named like its service. */
	private async classify(query?: LocateTargets): Promise<Targets> {
		const paths: string[] = [];
		const folders = new Set<string>();
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
			else {
				const resolved = path.resolve(query!.cwd, arg);
				paths.push(resolved);
				if (/[\\/]$/.test(arg)) folders.add(toPosix(resolved));
			}
		}
		return { paths, folders, instances };
	}
}
