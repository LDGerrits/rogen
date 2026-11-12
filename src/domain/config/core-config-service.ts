import path from "path";
import { Disposable, toDisposable } from "../../base/disposable.js";
import { isInside, samePath, shownFrom, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

import { ConfigFormatter } from "./config-formatter.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ConfigDiscovery } from "./config-discovery.js";
import {
	DEFAULT_PROJECT,
	configStem,
	isConfigFileName,
	isDefaultConfigFileName,
	isProjectFileConfig,
	projectStem,
} from "./config.js";
import { ConfigLoader } from "./config-loader.js";
import {
	ConfigEntry,
	ConfigFileCheck,
	ConfigFolderCheck,
	ReloadableSelection,
	ConfigService,
	ConfigCover,
	CoveredTargets,
	validFile,
} from "./config-service.js";
import { CoreConfigSelection, PickedFolder } from "./core-config-selection.js";
import { DefaultFolder } from "./default-folder.js";
import { ManagedConfig } from "./managed-config.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { ServiceCollection } from "../../platform/instantiation/service-collection.js";

export class CoreConfigService implements ConfigService {
	declare readonly _serviceBrand: undefined;

	private readonly discovery: ConfigDiscovery;
	private readonly loader: ConfigLoader;
	private readonly formatter: ConfigFormatter;
	private readonly fileChecks = new Set<ConfigFileCheck>();
	private readonly folderChecks = new Set<ConfigFolderCheck>();

	constructor(
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@EnvironmentService
		private readonly environmentService: EnvironmentService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {
		this.discovery = instantiationService.createInstance(
			ConfigDiscovery,
			this.folderChecks
		);
		this.loader = instantiationService.createInstance(
			ConfigLoader,
			this.fileChecks
		);
		this.formatter = instantiationService.createInstance(ConfigFormatter);
	}

	format(file: string): Promise<Result<boolean, Diagnostic[]>> {
		return this.formatter.format(file);
	}

	async select(
		refs: readonly string[],
		reader?: FileSystemService
	): Promise<Result<ReloadableSelection, Error>> {
		if (!reader) {
			return this.open(this.discovery, this.loader, refs);
		}
		const scope = this.instantiationService.createChild(
			new ServiceCollection([FileSystemService, reader])
		);
		const discovery = scope.createInstance(
			ConfigDiscovery,
			this.folderChecks
		);
		return this.open(
			discovery,
			scope.createInstance(ConfigLoader, this.fileChecks),
			refs
		);
	}

	/** Discovers `refs` and lists the default folder with `discovery`, so a selection through another file system reads only that one. */
	private async open(
		discovery: ConfigDiscovery,
		loader: ConfigLoader,
		refs: readonly string[]
	): Promise<Result<ReloadableSelection, Error>> {
		const discovered = await discovery.discover(refs);
		if (discovered.isErr()) return err(discovered.error);

		const { home: directory, files, noneNamed, notes } = discovered.value;
		return ok(
			await this.selectionOf(
				files,
				directory,
				noneNamed
					? new DefaultFolder(
							directory,
							discovery,
							files.some(isProjectFileConfig)
								? "adopting"
								: "configured"
						)
					: undefined,
				notes,
				loader
			)
		);
	}

	async selectHere(): Promise<ReloadableSelection> {
		const directory = this.environmentService.cwd;
		return this.selectionOf(
			await this.discovery.list(directory),
			directory,
			{
				directory,
				list: () => this.discovery.list(directory),
				holds: isConfigFileName,
			}
		);
	}

	private async selectionOf(
		files: readonly string[],
		directory: string,
		folder: PickedFolder | undefined,
		notes?: readonly string[],
		loader: ConfigLoader = this.loader
	): Promise<ReloadableSelection> {
		const opened = await Promise.all(
			files.map((file) => ManagedConfig.open(file, loader))
		);
		return new CoreConfigSelection(
			opened,
			loader,
			directory,
			folder,
			notes
		);
	}

	async selectCovering(
		targets: readonly (string | undefined)[]
	): Promise<Result<CoveredTargets, Error>> {
		const selections = new Map<string, ReloadableSelection>();
		const found = new Map<string, { indexes: number[]; whole: boolean }>();
		const uncovered: number[] = [];
		const coversAt = new Map<number, ConfigCover[]>();
		for (const [index, target] of targets.entries())
			if (target !== undefined)
				coversAt.set(index, await this.coversOf(target));
		const named = targets.includes(undefined)
			? [...coversAt.values()].flat().filter(({ whole }) => whole)
			: [];
		for (const [index, target] of targets.entries()) {
			let covers: ConfigCover[];
			if (target === undefined && named.length > 0)
				covers = named.map(({ file }) => ({ file, whole: false }));
			else if (target === undefined) {
				const here = await this.select([]);
				if (here.isErr()) return here;
				covers = [{ file: here.value.entries[0].file, whole: false }];
				selections.set(covers[0].file, here.value);
			} else covers = coversAt.get(index)!;
			if (named.length > 0 && covers.some(({ whole }) => whole)) continue;
			if (covers.length === 0) {
				uncovered.push(index);
				continue;
			}
			for (const cover of covers) {
				if (!selections.has(cover.file)) {
					const selection = await this.select([cover.file]);
					if (selection.isErr()) return selection;
					selections.set(cover.file, selection.value);
				}
				const group = found.get(cover.file) ?? {
					indexes: [],
					whole: false,
				};
				found.set(cover.file, {
					indexes: [...group.indexes, index],
					whole: group.whole || cover.whole,
				});
			}
		}
		return ok({
			groups: [...found].map(([file, { indexes, whole }]) => ({
				selection: selections.get(file)!,
				indexes,
				whole,
			})),
			uncovered,
		});
	}

	async namedConfigs(): Promise<string[]> {
		return (await this.discovery.list(this.environmentService.cwd)).filter(
			(file) => !isDefaultConfigFileName(path.basename(file))
		);
	}

	configsHere(): Promise<string[]> {
		return this.configsIn(this.environmentService.cwd);
	}

	configsIn(folder: string): Promise<string[]> {
		return this.discovery.list(folder);
	}

	plainProjectsHere(): Promise<string[]> {
		return this.discovery.plainProjects(this.environmentService.cwd);
	}

	async resolveNames(
		args: readonly string[]
	): Promise<Result<string[], Error>> {
		const { cwd } = this.environmentService;
		const resolved: string[] = [];
		for (const arg of args) {
			if (await this.isPath(path.resolve(cwd, arg))) {
				resolved.push(arg);
				continue;
			}
			const file = await this.discovery.fileNamedHere(arg);
			if (file.isErr()) return file;
			resolved.push(file.value ?? arg);
		}
		return ok(resolved);
	}

	async referenceTo(file: string, folder: string): Promise<string> {
		const base = path.basename(file);
		if (base.startsWith(`${DEFAULT_PROJECT}.`))
			return toPosix(path.relative(folder, path.dirname(file)));
		const stem =
			configStem(base) ??
			(isProjectFileConfig(base) ? projectStem(base) : undefined);
		const fileRef = shownFrom(folder, file);
		return stem !== undefined &&
			samePath(path.dirname(file), folder) &&
			!(await this.isPath(path.join(folder, stem))) &&
			(await this.discovery.stemReads(folder, stem, file))
			? stem
			: fileRef;
	}

	private async isPath(target: string): Promise<boolean> {
		if (!(await this.fileSystemService.exists(target))) return false;
		if (!(await this.fileSystemService.isDirectory(target))) return true;
		return (
			(await this.discovery.defaultConfigs(target)).length > 0 ||
			(await this.discovery.adoptable(target)) !== undefined
		);
	}

	async firstNotConfig(refs: readonly string[]): Promise<string | undefined> {
		for (const ref of refs)
			if (!(await this.discovery.namesConfig(ref))) return ref;
		return undefined;
	}

	async coversOf(target: string): Promise<ConfigCover[]> {
		const cover = await this.defaultCover(target);
		return cover ? [cover] : this.namedCovers(target);
	}

	private async defaultCover(
		target: string
	): Promise<ConfigCover | undefined> {
		const cover = await this.discovery.coverOf(target);
		if (!cover) return cover;
		if (cover.whole)
			return isProjectFileConfig(target)
				? ((await this.configAbove(target)) ?? cover)
				: cover;
		if (!isProjectFileConfig(cover.file)) return cover;
		return (await this.configAbove(cover.file)) ?? cover;
	}

	/** With no default config to answer, the named configs at and above `target` whose source paths cover it; one that is broken is kept unless its source paths can be told. */
	private async namedCovers(target: string): Promise<ConfigCover[]> {
		const covers: ConfigCover[] = [];
		for (const file of await this.discovery.namedConfigsAbove(target)) {
			const entry = await this.read(file);
			const sourcePaths =
				validFile(entry)?.config.sourcePaths ??
				(entry.status === "broken" ? entry.sourcePaths : undefined);
			if (sourcePaths && !(await this.covers(sourcePaths, target)))
				continue;
			covers.push({ file, whole: false });
		}
		return covers;
	}

	/** Whether a path lies in a source path, or, for a folder, holds one. */
	private async covers(
		sourcePaths: readonly string[],
		target: string
	): Promise<boolean> {
		const isFolder = await this.fileSystemService.isDirectory(target);
		const folder = isFolder ? target : path.dirname(target);
		return (
			coversFolder(sourcePaths, folder) ||
			(isFolder &&
				sourcePaths.some((sourcePath) => isInside(sourcePath, folder)))
		);
	}

	/** A plain project file inside the source paths of a `.rogen.json` above it belongs to that config. */
	private async configAbove(
		projectFile: string
	): Promise<ConfigCover | undefined> {
		const folder = path.dirname(projectFile);
		let directory = folder;
		for (;;) {
			const parent = path.dirname(directory);
			if (parent === directory) return undefined;
			const above = await this.discovery.coverOf(parent);
			if (!above) return undefined;
			directory = path.dirname(above.file);
			if (isProjectFileConfig(above.file)) continue;
			const { config } = validFile(await this.read(above.file)) ?? {};
			if (config && coversFolder(config.sourcePaths, folder))
				return above;
		}
	}

	async read(file: string): Promise<ConfigEntry> {
		return (await ManagedConfig.open(file, this.loader)).entry;
	}

	registerFolderCheck(check: ConfigFolderCheck): Disposable {
		this.folderChecks.add(check);
		return toDisposable(() => this.folderChecks.delete(check));
	}

	staleConfigsIn(folder: string): Promise<readonly Diagnostic[]> {
		return this.discovery.staleConfigsIn(folder);
	}

	registerFileCheck(check: ConfigFileCheck): Disposable {
		this.fileChecks.add(check);
		return toDisposable(() => this.fileChecks.delete(check));
	}
}

/** Whether `folder` is a source path or lies inside one. */
function coversFolder(sourcePaths: readonly string[], folder: string): boolean {
	return sourcePaths.some(
		(sourcePath) =>
			samePath(folder, sourcePath) || isInside(folder, sourcePath)
	);
}
