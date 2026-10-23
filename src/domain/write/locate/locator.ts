import path from "path";
import { compareStrings } from "../../../base/collections.js";
import { toPosix } from "../../../base/path.js";
import { Result, err, ok } from "../../../base/result.js";
import {
	Diagnostic,
	diagnosticsReaching,
	isRenameFix,
} from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import {
	FileReader,
	FileType,
} from "../../../platform/fs/file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { DeclaredKeys } from "../../config/declared-keys.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { InstanceReference } from "../../roblox/roblox.js";
import { RojoFile } from "../../rojo/rojo.js";
import { SyncTool } from "../../toolchain/toolchain.js";
import {
	ConfigLocations,
	FileLocation,
	InstanceFix,
	InstanceLocation,
	LocateQuery,
	Locations,
} from "../write-service.js";
import { WritePipeline } from "../write-pipeline.js";
import { MountedInstances } from "./mounted-instances.js";
import { PlacementLocator, placesInstance } from "./placement-locator.js";
import { LocateTargets, Targets } from "./locate-targets.js";
import { PlannedFilesIndex } from "./planned-files-index.js";

/** What `locate` found. */
export type Located = Omit<Locations, "errors" | "skipped">;

/** Answers `where` for a set of configs over one listing, placing files exactly as a write does. */
export class Locator {
	private readonly targets: LocateTargets;

	constructor(
		private readonly fileSystemService: FileReader,
		private readonly listing: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {
		this.targets = new LocateTargets(fileSystemService);
	}

	/** Fails when a config can't be placed; its caller checked that the configs are written together. */
	async locate(
		configs: readonly ResolvedConfig[],
		query?: LocateQuery
	): Promise<Result<Located, DiagnosticsError>> {
		const targets = await this.targets.classify(
			query ?? { args: [], cwd: "" }
		);
		const located: ConfigLocations[] = [];
		for (const config of configs) {
			const locations = await new ConfigLocator(
				config,
				this.fileSystemService,
				this.listing,
				this.tools
			).locate(targets);
			if (locations.isErr()) return locations;
			located.push(locations.value);
		}
		return ok({
			everyFile: targets.asked.length === 0,
			asked: targets.asked,
			configs: located,
		});
	}
}

class ConfigLocator {
	constructor(
		private readonly config: ResolvedConfig,
		private readonly fileSystemService: FileReader,
		private readonly listing: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {}

	async locate({
		paths,
		folders,
		instances,
	}: Targets): Promise<Result<ConfigLocations, DiagnosticsError>> {
		let files: FileLocation[] = [];
		let diagnostics: readonly Diagnostic[] = [];
		if (paths.length > 0) {
			const planned = await this.locatePaths(paths, folders);
			if (planned.isErr()) {
				if (instances.length > 0) return err(planned.error);
				const { diagnostics: stopped } = planned.error;
				return ok({
					config: this.config,
					files: await this.blocked(paths, stopped),
					instances: [],
					queried: paths.map(toPosix),
					diagnostics: stopped,
				});
			}
			({ files, diagnostics } = planned.value);
			if (instances.length === 0)
				return ok({
					config: this.config,
					files,
					instances: [],
					queried: paths.map(toPosix),
					diagnostics,
				});
		}

		const existing = await this.locatorOf(this.listing);
		if (existing.isErr()) return err(existing.error);
		const { locator } = existing.value;
		return ok({
			config: this.config,
			files:
				paths.length > 0 || instances.length > 0
					? files
					: await this.withMountedInstances(
							locator.locate(),
							locator
						),
			instances: await Promise.all(
				instances.map((reference) =>
					this.locateInstance(
						locator,
						existing.value.diagnostics,
						reference
					)
				)
			),
			queried: paths.map(toPosix),
			diagnostics:
				paths.length > 0 ? diagnostics : existing.value.diagnostics,
		});
	}

	private async blocked(
		paths: readonly string[],
		errors: readonly Diagnostic[]
	): Promise<FileLocation[]> {
		return Promise.all(
			paths.map(async (target): Promise<FileLocation> => {
				const source = toPosix(target);
				const own = errors.find(
					(error) => diagnosticsReaching([error], source).length > 0
				);
				return {
					source,
					exists: await this.fileSystemService.exists(target),
					status: "blocked",
					by: own ?? errors[0],
					own: own !== undefined,
				};
			})
		);
	}

	private async locatePaths(
		paths: readonly string[],
		folders: ReadonlySet<string>
	): Promise<
		Result<
			{
				readonly files: FileLocation[];
				readonly diagnostics: readonly Diagnostic[];
			},
			DiagnosticsError
		>
	> {
		const index = new PlannedFilesIndex(
			this.listing,
			this.config.sourcePaths,
			paths,
			(source) => RojoFile.at(source, this.config.syncRules)
		);
		const planned = await this.locatorOf(
			index,
			await this.existsOnDisk(index, paths)
		);
		if (planned.isErr()) return planned;
		const { locator, diagnostics } = planned.value;
		return ok({
			files: await this.withMountedInstances(
				locator.locate(paths, folders),
				locator
			),
			diagnostics,
		});
	}

	/** Each mounted file with the instance Rojo makes of it. */
	private async withMountedInstances(
		files: readonly FileLocation[],
		locator: PlacementLocator
	): Promise<FileLocation[]> {
		const mounted = this.mountedInstancesOf(locator);
		return Promise.all(
			files.map(async (location): Promise<FileLocation> => {
				if (location.status !== "mounted" || location.instancePath)
					return location;
				const instancePath = await mounted.instanceOf(location.source);
				return instancePath ? { ...location, instancePath } : location;
			})
		);
	}

	private mountedInstancesOf(locator: PlacementLocator): MountedInstances {
		return new MountedInstances(
			this.fileSystemService,
			locator.mounts,
			this.config.syncRules
		);
	}

	private async locateInstance(
		locator: PlacementLocator,
		diagnostics: readonly Diagnostic[],
		reference: InstanceReference
	): Promise<InstanceLocation> {
		const files = locator.locateInstance(reference);
		if (files.length > 0)
			return { reference, files, folders: [], fixes: [] };
		const mounted =
			await this.mountedInstancesOf(locator).filesAt(reference);
		if (mounted.length > 0)
			return { reference, files: mounted, folders: [], fixes: [] };
		const fixes = await this.renamesPlacing(diagnostics, reference);
		const known = locator.foldersFor(reference);
		return {
			reference,
			files,
			folders:
				known.length > 0 || fixes.length > 0
					? known
					: await this.foldersForNewFile(reference),
			fixes,
		};
	}

	private async renamesPlacing(
		diagnostics: readonly Diagnostic[],
		reference: InstanceReference
	): Promise<InstanceFix[]> {
		const found: InstanceFix[] = [];
		for (const { code, fixes } of diagnostics) {
			for (const { rename } of (fixes ?? []).filter(isRenameFix)) {
				const posix = {
					from: toPosix(rename.from),
					to: toPosix(rename.to),
				};
				if (
					found.some(
						({ rename: other }) =>
							other.from === posix.from && other.to === posix.to
					)
				)
					continue;
				const placed = await this.placeNew(posix.to);
				if (
					placed.some((location) =>
						placesInstance(location, reference)
					)
				)
					found.push({ code, rename: posix });
			}
		}
		return found;
	}

	private async foldersForNewFile(
		reference: InstanceReference
	): Promise<string[]> {
		const declared = await this.foldersUnderDeclaredRoutes(reference);
		const found =
			declared.length > 0
				? declared
				: await this.foldersUnderRoute(
						DeclaredKeys.FALLBACK_ROUTE,
						reference
					);
		return [...new Set(found)].sort(compareStrings);
	}

	private async foldersUnderDeclaredRoutes(
		reference: InstanceReference
	): Promise<string[]> {
		const keys = [...this.config.routes.keys()].filter(
			(key) => key !== DeclaredKeys.FALLBACK_ROUTE
		);
		return (
			await Promise.all(
				keys.map((key) => this.foldersUnderRoute(key, reference))
			)
		).flat();
	}

	private static belowRoute(
		lead: readonly string[],
		reference: InstanceReference
	): { readonly below: string[]; readonly leaf: string } | undefined {
		const names = reference.text.split(reference.separator);
		if (
			names.length <= lead.length ||
			!lead.every((name, index) => name === names[index])
		)
			return undefined;
		const rest = names.slice(lead.length);
		return { below: rest.slice(0, -1), leaf: rest[rest.length - 1] };
	}

	private async foldersUnderRoute(
		key: string,
		reference: InstanceReference
	): Promise<string[]> {
		const target = this.config.routes.get(key);
		if (!target) return [];
		const beneath = ConfigLocator.belowRoute(
			target.instancePath,
			reference
		);
		if (!beneath) return [];
		const { below, leaf } = beneath;
		const folders = new Set<string>();
		for (const sourcePath of this.config.sourcePaths) {
			const { dir, matched } = this.deepestExisting(sourcePath, below);
			const folder = path.posix.join(
				dir,
				...below.slice(matched),
				...(key === DeclaredKeys.FALLBACK_ROUTE ? [] : [key])
			);
			const placed = await this.placeNew(
				path.posix.join(folder, `${leaf}.luau`)
			);
			if (
				placed.some(
					(location) =>
						location.status === "placed" &&
						location.instancePath.join(reference.separator) ===
							reference.text
				)
			)
				folders.add(folder);
		}
		return [...folders];
	}

	private deepestExisting(
		sourcePath: string,
		names: readonly string[]
	): { dir: string; matched: number } {
		let dir = toPosix(sourcePath);
		let matched = 0;
		while (
			matched < names.length &&
			this.listing.getEntryType(dir, names[matched]) ===
				FileType.Directory
		) {
			dir = path.posix.join(dir, names[matched]);
			matched++;
		}
		return { dir, matched };
	}

	private async placeNew(file: string): Promise<FileLocation[]> {
		const index = new PlannedFilesIndex(
			this.listing,
			this.config.sourcePaths,
			[file],
			(source) => RojoFile.at(source, this.config.syncRules)
		);
		const placement = await this.pipelineOf(index).place(this.config);
		return placement.isOk()
			? new PlacementLocator(
					placement.value,
					index,
					await this.existsOnDisk(index, [file])
				).locate([file])
			: [];
	}

	private async locatorOf(
		index: IndexReader,
		exists?: (source: string) => boolean
	): Promise<
		Result<
			{
				readonly locator: PlacementLocator;
				readonly diagnostics: readonly Diagnostic[];
			},
			DiagnosticsError
		>
	> {
		const pipeline = this.pipelineOf(index);
		const examined = await pipeline.examine(this.config);
		return examined.map((result) => ({
			locator: new PlacementLocator(result.placement, index, exists),
			diagnostics:
				result.kind === "assembled" ? result.warnings : result.errors,
		}));
	}

	private pipelineOf(index: IndexReader): WritePipeline {
		return new WritePipeline(this.fileSystemService, index, this.tools);
	}

	private async existsOnDisk(
		index: PlannedFilesIndex,
		paths: readonly string[]
	): Promise<(source: string) => boolean> {
		const known = new Map<string, boolean>();
		for (const target of paths)
			known.set(
				toPosix(target),
				!index.isPlanned(target) && (await this.isOnDisk(target))
			);
		return (source) => known.get(source) ?? !index.isPlanned(source);
	}

	private async isOnDisk(target: string): Promise<boolean> {
		return (
			this.listing.hasEntry(
				path.dirname(target),
				path.basename(target)
			) || (await this.fileSystemService.exists(target))
		);
	}
}
