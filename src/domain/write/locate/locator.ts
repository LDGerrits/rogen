import { RojoProjectFile } from "../../rojo/rojo-project.js";
import path from "path";
import { compareByCodePoint, groupBy } from "../../../base/collections.js";
import { toPosix } from "../../../base/path.js";
import { Result, err, ok } from "../../../base/result.js";
import {
	Diagnostic,
	isRenameFix,
	reaches,
} from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { DeclaredKeys } from "../../config/declared-keys.js";
import { ResolvedConfig, scannedFileOf } from "../../config/resolved-config.js";
import { InstanceReference } from "../../roblox/roblox.js";
import { SyncTool } from "../../toolchain/toolchain.js";
import {
	ConfigLocations,
	FileLocation,
	InstanceFix,
	InstanceLocation,
	LocateQuery,
	Locations,
	RaisedDiagnostics,
} from "../write-service.js";
import {
	PipelineRun,
	WritePipeline,
	diagnosticsOf,
} from "../write-pipeline.js";
import { ProjectFileStaleness } from "../check/project-file-staleness.js";
import { CheckedConfig, FailedConfig, SyncWarnings } from "../write.js";
import { MountedInstances } from "./mounted-instances.js";
import { PlacementLocator, placesInstance } from "./placement-locator.js";
import { LocateTargets, Targets } from "./locate-targets.js";
import { PlannedFilesIndex } from "./planned-files-index.js";
import { InstantiationService } from "../../../platform/instantiation/instantiation-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";

export type Located = Omit<Locations, "errors" | "skipped">;

export class Locator {
	private readonly targets: LocateTargets;

	constructor(
		private readonly listing: IndexReader,
		private readonly tools: readonly SyncTool[],
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {
		this.targets = instantiationService.createInstance(LocateTargets);
	}

	async locate(
		configs: readonly ResolvedConfig[],
		query?: LocateQuery
	): Promise<Result<Located, DiagnosticsError>> {
		const located = await this.run(configs, query, SyncWarnings.deferred);
		return located.map(({ targets, runs }) => ({
			everyFile: targets.asked.length === 0,
			asked: targets.asked,
			configs: runs.map(({ locations }) => locations),
		}));
	}

	/**
	 * Locates as `locate` does, and gives each config the findings a whole
	 * check of it raises and those of them that are about the config itself.
	 */
	async check(
		configs: readonly ResolvedConfig[],
		query: LocateQuery
	): Promise<Result<CheckedLocations[], DiagnosticsError>> {
		const located = await this.run(configs, query, SyncWarnings.unknown);
		if (located.isErr()) return located;
		const staleness =
			this.instantiationService.createInstance(ProjectFileStaleness);
		const checked: CheckedLocations[] = [];
		for (const { locations, run, planned } of located.value.runs) {
			const { config } = locations;
			const raised = diagnosticsOf(run);
			let findings = FailedConfig.before(
				config,
				raised,
				SyncWarnings.unknown
			).diagnostics;
			if (run.stoppedAt === "end") {
				const { prepared } = run;
				const stale = planned
					? undefined
					: await staleness.diagnostic(
							config,
							async () => prepared.projectFile
						);
				findings = new CheckedConfig(
					config,
					{
						...prepared.findings,
						warnings: [
							...prepared.findings.warnings,
							...(stale ? [stale] : []),
						],
					},
					prepared.summary,
					prepared.readFiles
				).diagnostics;
			}
			checked.push({
				locations,
				findings,
				own: new Set([
					...config.warnings,
					...findings.filter(
						(diagnostic) => !raised.includes(diagnostic)
					),
				]),
			});
		}
		return ok(checked);
	}

	private async run(
		configs: readonly ResolvedConfig[],
		query: LocateQuery | undefined,
		sync: SyncWarnings
	): Promise<
		Result<
			{ readonly targets: Targets; readonly runs: LocatedRun[] },
			DiagnosticsError
		>
	> {
		const targets = await this.targets.classify(
			query ?? { args: [], cwd: "" }
		);
		const runs: LocatedRun[] = [];
		for (const config of configs) {
			const located = await this.instantiationService
				.createInstance(
					ConfigLocator,
					config,
					this.listing,
					this.tools,
					sync
				)
				.locate(targets);
			if (located.isErr()) return located;
			runs.push(located.value);
		}
		return ok({ targets, runs });
	}
}

export interface CheckedLocations {
	readonly locations: ConfigLocations;
	readonly findings: readonly Diagnostic[];
	readonly own: ReadonlySet<Diagnostic>;
}

interface LocatedRun {
	readonly locations: ConfigLocations;
	readonly run: PipelineRun;
	readonly planned: boolean;
}

class ConfigLocator {
	constructor(
		private readonly config: ResolvedConfig,
		private readonly listing: IndexReader,
		private readonly tools: readonly SyncTool[],
		private readonly sync: SyncWarnings,
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {}

	async locate({
		paths,
		folders,
		instances,
	}: Targets): Promise<Result<LocatedRun, DiagnosticsError>> {
		const queried = paths.map(toPosix);
		let files: FileLocation[] = [];
		let raised: RaisedDiagnostics = { diagnostics: [], markers: [] };
		let pathsRun: { run: PipelineRun; planned: boolean } | undefined;
		if (paths.length > 0) {
			const planned = await this.locatePaths(paths, folders);
			if (planned.isErr()) {
				if (instances.length > 0) return err(planned.error);
				const { diagnostics } = planned.error;
				return ok({
					locations: {
						config: this.config,
						files: await this.blocked(paths, diagnostics),
						instances: [],
						queried,
						diagnostics,
						markers: [],
					},
					run: { stoppedAt: "placement", errors: diagnostics },
					planned: false,
				});
			}
			({ files, raised } = planned.value);
			pathsRun = planned.value;
			if (instances.length === 0)
				return ok({
					locations: {
						config: this.config,
						files,
						instances: [],
						queried,
						...raised,
					},
					...pathsRun,
				});
		}

		const existing = await this.locatorOf(this.listing);
		if (existing.isErr()) return err(existing.error);
		const { locator } = existing.value;
		return ok({
			run: pathsRun?.run ?? existing.value.run,
			planned: pathsRun?.planned ?? false,
			locations: {
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
							existing.value.raised.diagnostics,
							reference
						)
					)
				),
				queried,
				...(paths.length > 0 ? raised : existing.value.raised),
				...(existing.value.projectFile && {
					projectFile: existing.value.projectFile,
				}),
			},
		});
	}

	private async blocked(
		paths: readonly string[],
		errors: readonly Diagnostic[]
	): Promise<FileLocation[]> {
		return Promise.all(
			paths.map(async (target): Promise<FileLocation> => {
				const source = toPosix(target);
				const own = errors.find((error) => reaches(error, source));
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
				readonly raised: RaisedDiagnostics;
				readonly run: PipelineRun;
				readonly planned: boolean;
			},
			DiagnosticsError
		>
	> {
		const index = new PlannedFilesIndex(
			this.listing,
			this.config.sourcePaths,
			paths,
			(source) => scannedFileOf(this.config, source)
		);
		const planned = await this.locatorOf(
			index,
			await this.existsOnDisk(index, paths)
		);
		if (planned.isErr()) return planned;
		const { locator, raised, run } = planned.value;
		return ok({
			files: await this.withMountedInstances(
				locator.locate(paths, folders),
				locator
			),
			raised,
			run,
			planned: paths.some((target) => index.isPlanned(target)),
		});
	}

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
		const character = reference.characterScript;
		const copied = character ? locator.locateInstance(character) : [];
		if (copied.length > 0)
			return { reference, files: copied, folders: [], fixes: [] };
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
		const proposed = diagnostics.flatMap(({ code, fixes }) =>
			(fixes ?? [])
				.filter(isRenameFix)
				.map(({ rename }): InstanceFix => ({
					code,
					rename: {
						from: toPosix(rename.from),
						to: toPosix(rename.to),
					},
				}))
		);
		const found: InstanceFix[] = [];
		for (const [fix] of groupBy(
			proposed,
			({ rename }) => `${rename.from}\0${rename.to}`
		).values()) {
			const placed = await this.placeNew(fix.rename.to);
			if (placed.some((location) => placesInstance(location, reference)))
				found.push(fix);
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
		return [...new Set(found)].sort(compareByCodePoint);
	}

	private async foldersUnderDeclaredRoutes(
		reference: InstanceReference
	): Promise<string[]> {
		const keys = [...this.config.keys.routeKeys];
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
			(source) => scannedFileOf(this.config, source)
		);
		const placement = await this.pipelineOf(index).place(this.config);
		return new PlacementLocator(
			placement.unwrap(),
			index,
			await this.existsOnDisk(index, [file])
		).locate([file]);
	}

	private async locatorOf(
		index: IndexReader,
		exists?: (source: string) => boolean
	): Promise<
		Result<
			{
				readonly locator: PlacementLocator;
				readonly raised: RaisedDiagnostics;
				readonly projectFile?: RojoProjectFile;
				readonly run: PipelineRun;
			},
			DiagnosticsError
		>
	> {
		const run = await this.pipelineOf(index).run(this.config, this.sync);
		if (run.stoppedAt === "placement")
			return err(new DiagnosticsError(run.errors));
		const locator = new PlacementLocator(run.placement, index, exists);
		return ok({
			locator,
			run,
			raised: {
				diagnostics: diagnosticsOf(run),
				markers: locator.markers,
			},
			...(run.stoppedAt === "end" && {
				projectFile: run.prepared.projectFile,
			}),
		});
	}

	private pipelineOf(index: IndexReader): WritePipeline {
		return this.instantiationService.createInstance(
			WritePipeline,
			index,
			this.tools
		);
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
