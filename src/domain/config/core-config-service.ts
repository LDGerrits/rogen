import path from "path";
import { Disposable } from "../../base/disposable.js";
import { isInside, samePath } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

import { ConfigFormatter } from "./config-formatter.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ConfigDiscovery, DiscoveredConfigs } from "./config-discovery.js";
import { isProjectFileConfig } from "./config.js";
import { ConfigLoader } from "./config-loader.js";
import {
	ConfigEntry,
	ConfigFileCheck,
	ReloadableSelection,
	ConfigService,
	ConfigCover,
	CoveredTargets,
	buildableFile,
	EnclosingConfigs,
} from "./config-service.js";
import { CoreConfigSelection } from "./core-config-selection.js";
import { ManagedConfig } from "./managed-config.js";

export class CoreConfigService implements ConfigService {
	declare readonly _serviceBrand: undefined;

	private readonly discovery: ConfigDiscovery;
	private readonly loader: ConfigLoader;
	private readonly formatter: ConfigFormatter;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {
		this.discovery = new ConfigDiscovery(
			fileSystemService,
			environmentService
		);
		this.loader = new ConfigLoader(fileSystemService);
		this.formatter = new ConfigFormatter(fileSystemService);
	}

	format(file: string): Promise<Result<boolean, Diagnostic[]>> {
		return this.formatter.format(file);
	}

	async select(
		refs: readonly string[]
	): Promise<Result<ReloadableSelection, Error>> {
		return this.open(await this.discovery.discover(refs));
	}

	async selectFolder(): Promise<Result<ReloadableSelection, Error>> {
		return this.open(await this.discovery.discoverFolder());
	}

	private async open(
		discovered: Result<DiscoveredConfigs, Error>
	): Promise<Result<ReloadableSelection, Error>> {
		if (discovered.isErr()) return err(discovered.error);

		const { home: directory, files, noneNamed, notes } = discovered.value;
		const opened = await Promise.all(
			files.map((file) => ManagedConfig.open(file, this.loader))
		);
		return ok(
			new CoreConfigSelection(
				opened,
				this.loader,
				directory,
				noneNamed && !files.some(isProjectFileConfig)
					? { directory, list: () => this.firstConfigIn(directory) }
					: undefined,
				notes
			)
		);
	}

	private async firstConfigIn(directory: string): Promise<string[]> {
		return (await this.discovery.defaultConfigs(directory)).slice(0, 1);
	}

	async selectCovering(
		targets: readonly (string | undefined)[]
	): Promise<Result<CoveredTargets, Error>> {
		const selections = new Map<string, ReloadableSelection>();
		const found = new Map<string, { indexes: number[]; whole: boolean }>();
		const uncovered: number[] = [];
		for (const [index, target] of targets.entries()) {
			let covers: ConfigCover[];
			if (target === undefined) {
				const here = await this.select([]);
				if (here.isErr()) return here;
				covers = [{ file: here.value.entries[0].file, whole: false }];
				selections.set(covers[0].file, here.value);
			} else covers = await this.coversOf(target);
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

	async coversOf(target: string): Promise<ConfigCover[]> {
		const cover = await this.defaultCover(target);
		return cover ? [cover] : this.namedCovers(target);
	}

	private async defaultCover(
		target: string
	): Promise<ConfigCover | undefined> {
		const cover = await this.discovery.coverOf(target);
		if (!cover || cover.whole || !isProjectFileConfig(cover.file))
			return cover;
		return (await this.configAbove(cover.file)) ?? cover;
	}

	/** With no default config to answer, the named configs at and above `target` whose source paths cover it; one that is broken is kept, since its source paths can't be told. */
	private async namedCovers(target: string): Promise<ConfigCover[]> {
		const covers: ConfigCover[] = [];
		for (const file of await this.discovery.namedConfigsAbove(target)) {
			const { config } = buildableFile(await this.read(file)) ?? {};
			if (config && !(await this.covers(config.sourcePaths, target)))
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
			const { config } = buildableFile(await this.read(above.file)) ?? {};
			if (config && coversFolder(config.sourcePaths, folder))
				return above;
		}
	}

	findEnclosing(from?: string): Promise<EnclosingConfigs | undefined> {
		return this.discovery.findEnclosing(from);
	}

	async read(file: string): Promise<ConfigEntry> {
		return (await ManagedConfig.open(file, this.loader)).entry;
	}

	registerFileCheck(check: ConfigFileCheck): Disposable {
		return this.loader.registerFileCheck(check);
	}
}

/** Whether `folder` is a source path or lies inside one. */
function coversFolder(sourcePaths: readonly string[], folder: string): boolean {
	return sourcePaths.some(
		(sourcePath) =>
			samePath(folder, sourcePath) || isInside(folder, sourcePath)
	);
}
