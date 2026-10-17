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
import { RojoProjectFile } from "../../rojo/rojo-project.js";
import { SyncRules } from "../../rojo/sync-rules.js";
import { SyncTool } from "../../toolchain/toolchain.js";
import {
	Asked,
	ConfigLocations,
	FileLocation,
	InstanceFix,
	InstanceLocation,
	LocateQuery,
	Locations,
} from "../build-service.js";
import { ConfigBuilder } from "../config-builder.js";
import { PlacementLocator, placesInstance } from "./placement-locator.js";
import { PlannedFilesIndex } from "./planned-files-index.js";

interface Targets {
	readonly paths: readonly string[];
	readonly folders: ReadonlySet<string>;
	readonly instances: readonly InstanceReference[];
	readonly asked: readonly Asked[];
}

/** The project file a build of a config would write, or none when it fails; examined over the listing as it is on disk. */
export interface AssembledFile {
	readonly file: RojoProjectFile | undefined;
}

/** What `locate` found, and for each config the examination over the listing as it is, which a project file's staleness is judged by. */
export type Located = Omit<Locations, "errors" | "stale"> & {
	readonly built: ReadonlyMap<ResolvedConfig, AssembledFile>;
};

/** Answers `where` for a set of configs over one listing, placing files exactly as a build does. */
export class Locator {
	constructor(
		private readonly fileSystemService: FileReader,
		private readonly listing: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {}

	/** Fails when a config can't be placed; its caller checked that the configs build together. */
	async locate(
		configs: readonly ResolvedConfig[],
		query?: LocateQuery
	): Promise<Result<Located, DiagnosticsError>> {
		const targets = await this.classify(query ?? { args: [], cwd: "" });
		const located: ConfigLocations[] = [];
		const built = new Map<ResolvedConfig, AssembledFile>();
		for (const config of configs) {
			const locations = await new ConfigLocator(
				config,
				this.fileSystemService,
				this.listing,
				this.tools
			).locate(targets);
			if (locations.isErr()) return locations;
			located.push(locations.value.locations);
			if (locations.value.built) built.set(config, locations.value.built);
		}
		return ok({
			everyFile: targets.asked.length === 0,
			asked: targets.asked,
			configs: located,
			built,
		});
	}

	private async withoutPosition(arg: string, cwd: string): Promise<string> {
		const head = (/^(.+?):\d+(?::\d+)?(?:[:\s].*)?$/.exec(arg) ??
			/^(.+):$/.exec(arg))?.[1];
		if (head === undefined) return arg;
		return new RojoFile(path.basename(head), SyncRules.DEFAULT).kind !==
			undefined ||
			(await this.fileSystemService.exists(path.resolve(cwd, head)))
			? head
			: arg;
	}

	private async classify({ args, cwd }: LocateQuery): Promise<Targets> {
		const paths: string[] = [];
		const folders = new Set<string>();
		const instances: InstanceReference[] = [];
		const asked: Asked[] = [];
		for (const given of args) {
			const reference = InstanceReference.parse(given);
			if (
				reference &&
				!(await this.fileSystemService.exists(
					path.resolve(cwd, reference.service)
				))
			) {
				instances.push(reference);
				asked.push({ instance: reference.text });
			} else {
				const arg = await this.withoutPosition(toPosix(given), cwd);
				const resolved = path.resolve(cwd, arg);
				paths.push(resolved);
				asked.push({ path: toPosix(resolved) });
				if (arg.endsWith("/")) folders.add(toPosix(resolved));
			}
		}
		return { paths, folders, instances, asked };
	}
}

class ConfigLocator {
	constructor(
		private readonly config: ResolvedConfig,
		private readonly fileSystemService: FileReader,
		private readonly listing: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {}

	async locate({ paths, folders, instances }: Targets): Promise<
		Result<
			{
				readonly locations: ConfigLocations;
				readonly built: AssembledFile | undefined;
			},
			DiagnosticsError
		>
	> {
		let files: FileLocation[] = [];
		let diagnostics: readonly Diagnostic[] = [];
		if (paths.length > 0) {
			const planned = await this.locatePaths(paths, folders);
			if (planned.isErr()) {
				if (instances.length > 0) return err(planned.error);
				const { diagnostics: stopped } = planned.error;
				return ok({
					locations: {
						config: this.config,
						files: await this.blocked(paths, stopped),
						instances: [],
						queried: paths.map(toPosix),
						diagnostics: stopped,
					},
					built: undefined,
				});
			}
			({ files, diagnostics } = planned.value);
			if (instances.length === 0)
				return ok({
					locations: {
						config: this.config,
						files,
						instances: [],
						queried: paths.map(toPosix),
						diagnostics,
					},
					built: planned.value.built,
				});
		}

		const existing = await this.locatorOf(this.listing);
		if (existing.isErr()) return err(existing.error);
		const { locator } = existing.value;
		return ok({
			locations: {
				config: this.config,
				files:
					paths.length > 0 || instances.length > 0
						? files
						: locator.locate(),
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
			},
			built: existing.value.built,
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
				readonly built: AssembledFile | undefined;
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
		return planned.map(({ locator, diagnostics, built }) => ({
			files: locator.locate(paths, folders),
			diagnostics,
			built: index.addsNothing ? built : undefined,
		}));
	}

	private async locateInstance(
		locator: PlacementLocator,
		diagnostics: readonly Diagnostic[],
		reference: InstanceReference
	): Promise<InstanceLocation> {
		const files = locator.locateInstance(reference);
		if (files.length > 0)
			return { reference, files, folders: [], fixes: [] };
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
		const placement = await this.builderOf(index).place(this.config);
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
				/** What a build of the config would write from `index`. */
				readonly built: AssembledFile;
			},
			DiagnosticsError
		>
	> {
		const builder = this.builderOf(index);
		const examined = await builder.examine(this.config);
		return examined.map((result) => ({
			locator: new PlacementLocator(result.placement, index, exists),
			diagnostics:
				result.kind === "assembled" ? result.warnings : result.errors,
			built: { file: builder.assembledFile(this.config, result) },
		}));
	}

	private builderOf(index: IndexReader): ConfigBuilder {
		return new ConfigBuilder(this.fileSystemService, index, this.tools);
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
