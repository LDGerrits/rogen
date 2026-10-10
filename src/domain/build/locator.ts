import path from "path";
import { compareStrings } from "../../base/collections.js";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	diagnosticsReaching,
	isRenameFix,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileReader, FileType } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { InstanceReference } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncTool } from "./build.js";
import {
	ConfigLocations,
	FileLocation,
	InstanceFix,
	InstanceLocation,
	LocateTargets,
	Locations,
} from "./build-service.js";
import { ConfigBuilder } from "./config-builder.js";
import { FileLocator, placesInstance } from "./file-locator.js";
import { PlannedFilesIndex } from "./planned-files-index.js";

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
		private readonly fileSystemService: FileReader,
		private readonly listing: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {}

	/** Fails when a config can't be placed; its caller checked that the configs build together. */
	async locate(
		configs: readonly ResolvedConfig[],
		query?: LocateTargets
	): Promise<Result<Locations, DiagnosticsError>> {
		const targets = await this.classify(query ?? { args: [], cwd: "" });
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
			const planned = await this.locatePaths(config, paths, folders);
			if (planned.isErr()) {
				if (instances.length > 0) return err(planned.error);
				const { diagnostics: stopped } = planned.error;
				return ok({
					config,
					files: await this.blocked(paths, stopped),
					instances: [],
					diagnostics: stopped,
				});
			}
			({ files, diagnostics } = planned.value);
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
			instances: await Promise.all(
				instances.map((reference) =>
					this.locateInstance(
						config,
						locator,
						existing.value.diagnostics,
						reference
					)
				)
			),
			diagnostics:
				paths.length > 0 ? diagnostics : existing.value.diagnostics,
		});
	}

	/** The answer for `paths` when the build of the config stops on `errors`: none can be placed, and each is told the error that is about it, else the first. */
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

	/** Where `paths` land, placing the ones that don't exist yet as if they did. */
	private async locatePaths(
		config: ResolvedConfig,
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
			config.rootDirs,
			paths
		);
		const planned = await this.locatorOf(
			index,
			config,
			await this.existence(index, paths)
		);
		return planned.map(({ locator, diagnostics }) => ({
			files: locator.locate(paths, folders),
			diagnostics,
		}));
	}

	/** The files placed at `reference`; when none is, the folders a new file goes in and the renames that would place one. */
	private async locateInstance(
		config: ResolvedConfig,
		locator: FileLocator,
		diagnostics: readonly Diagnostic[],
		reference: InstanceReference
	): Promise<InstanceLocation> {
		const files = locator.locateInstance(reference);
		if (files.length > 0)
			return { reference, files, folders: [], fixes: [] };
		const fixes = await this.renamesPlacing(config, diagnostics, reference);
		const known = locator.foldersFor(reference);
		return {
			reference,
			files,
			folders:
				known.length > 0 || fixes.length > 0
					? known
					: await this.foldersForNewFile(config, reference),
			fixes,
		};
	}

	/** The renames among `diagnostics` after which a file places `reference`, each checked by placing the renamed path as `build` would. */
	private async renamesPlacing(
		config: ResolvedConfig,
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
				const placed = await this.placeNew(config, posix.to);
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

	/** The folders a first file for `reference` goes in: for each route whose target leads its path, the deepest folder in a root dir that holds the path's leading names, then the route's folder. Only those where a file placed there lands at `reference`. */
	private async foldersForNewFile(
		config: ResolvedConfig,
		reference: InstanceReference
	): Promise<string[]> {
		const keys = [...config.routes.keys()];
		const routed = (
			await Promise.all(
				keys
					.filter((key) => key !== "*")
					.map((key) =>
						this.foldersUnderRoute(config, key, reference)
					)
			)
		).flat();
		const found =
			routed.length > 0
				? routed
				: await this.foldersUnderRoute(config, "*", reference);
		return [...new Set(found)].sort(compareStrings);
	}

	/** The folders under the route `key` where a first file for `reference` lands at it; none when the route's target doesn't lead the path. */
	private async foldersUnderRoute(
		config: ResolvedConfig,
		key: string,
		reference: InstanceReference
	): Promise<string[]> {
		const target = config.routes.get(key);
		if (!target) return [];
		const names = reference.text.split(reference.separator);
		const lead = target.instancePath;
		if (
			names.length <= lead.length ||
			!lead.every((name, index) => name === names[index])
		)
			return [];
		const rest = names.slice(lead.length);
		const leaf = rest[rest.length - 1];
		const below = rest.slice(0, -1);
		const folders = new Set<string>();
		for (const rootDir of config.rootDirs) {
			const { dir, matched } = this.deepestExisting(rootDir, below);
			const folder = path.posix.join(
				dir,
				...below.slice(matched),
				...(key === "*" ? [] : [key])
			);
			const placed = await this.placeNew(
				config,
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

	/** The deepest folder of `rootDir` that holds the leading `names`, and how many of them it holds. */
	private deepestExisting(
		rootDir: string,
		names: readonly string[]
	): { dir: string; matched: number } {
		let dir = toPosix(rootDir);
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

	/** Where a file at `file`, which need not exist, lands in `config`; nothing when the config can't be placed. Placing is all it takes, so the later phases don't run. */
	private async placeNew(
		config: ResolvedConfig,
		file: string
	): Promise<FileLocation[]> {
		const index = new PlannedFilesIndex(this.listing, config.rootDirs, [
			file,
		]);
		const placement = this.builderOf(index).place(config);
		return placement.isOk()
			? new FileLocator(
					placement.value,
					index,
					await this.existence(index, [file])
				).locate([file])
			: [];
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
		const examined = await this.builderOf(index).examine(config);
		return examined.map((result) => ({
			locator: new FileLocator(result.placement, index, exists),
			diagnostics:
				result.kind === "assembled" ? result.warnings : result.errors,
		}));
	}

	private builderOf(index: IndexReader): ConfigBuilder {
		return new ConfigBuilder(this.fileSystemService, index, this.tools);
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

	/** `arg` without a `:line`, `:line:col` or bare `:` after the path, and what follows it (`: attempt to index nil`), as a linter or a log prints it. It is only cut when what is left exists or has a file type Rojo reads, so a Windows drive letter or a colon in a name stays. */
	private async withoutPosition(arg: string, cwd: string): Promise<string> {
		const head = (/^(.+?):\d+(?::\d+)?(?:[:\s].*)?$/.exec(arg) ??
			/^(.+):$/.exec(arg))?.[1];
		if (head === undefined) return arg;
		return new RojoFile(path.basename(head)).kind !== undefined ||
			(await this.fileSystemService.exists(path.resolve(cwd, head)))
			? head
			: arg;
	}

	/** An argument is an instance when it reads as one and the working dir holds no entry named like its service. */
	private async classify({ args, cwd }: LocateTargets): Promise<Targets> {
		const paths: string[] = [];
		const folders = new Set<string>();
		const instances: InstanceReference[] = [];
		for (const given of args) {
			const reference = InstanceReference.parse(given);
			if (
				reference &&
				!(await this.fileSystemService.exists(
					path.resolve(cwd, reference.service)
				))
			)
				instances.push(reference);
			else {
				// A backslash is a separator on every platform, so a Windows-style path answers as its slash form does.
				const arg = await this.withoutPosition(toPosix(given), cwd);
				const resolved = path.resolve(cwd, arg);
				paths.push(resolved);
				if (arg.endsWith("/")) folders.add(toPosix(resolved));
			}
		}
		return { paths, folders, instances };
	}
}
