import path from "path";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	FileReader,
	FileType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import {
	CONFIG_FILE_NAMES,
	DEFAULT_PROJECT,
	DEFAULT_PROJECT_FILE,
	PROJECT_NAME,
	isConfigFileName,
} from "./config.js";
import { EnclosingConfigs } from "./config-service.js";

/** The suffixes of the project files Rojo reads by name. */
const PROJECT_SUFFIXES = [".project.json", ".project.jsonc"];

/** The config files a command reads, and the folder it looked in. */
export interface DiscoveredConfigs {
	/** The working directory, or the nearest folder above it with a config when the working directory has none. */
	readonly home: string;
	/** Absolute paths. */
	readonly files: readonly string[];
	/** Whether none was named, so `files` is the config of `home`. */
	readonly everyConfig: boolean;
	/** The project a config was named for, by a `*.project.json` path or a bare name, by config file; whether the config has it is for the config to say. */
	readonly projects: ReadonlyMap<string, string>;
	/** The bare names that are also a folder with a config: the folder is what they name. */
	readonly folders: readonly string[];
	/** The config of `home`, the one a bare project name belongs to. */
	readonly homeConfig: string | undefined;
}

/** What one named path stands for. */
interface NamedConfig {
	readonly file: string;
	readonly project?: string;
	/** Set when a bare name is a folder with a config. */
	readonly folder?: string;
}

/** Whether `ref` could be a project's name rather than a path. */
const isBareName = (ref: string): boolean => PROJECT_NAME.test(ref);

/** Finds which config files a command reads: in the working directory, else in the nearest folder above that has one. */
export class ConfigDiscovery {
	constructor(
		private readonly fileSystemService: FileReader,
		private readonly environmentService: EnvironmentService
	) {}

	/** The config files `refs` names, each a folder, a config file, a `*.project.json` path or the name of a project of the config here, or the config of the folder found when it names none. A path resolves from the working directory. */
	async discover(
		refs: readonly string[]
	): Promise<Result<DiscoveredConfigs, Error>> {
		const cwd = this.environmentService.cwd;
		const home = await this.home();
		if (refs.length === 0) {
			if (home.isErr()) return err(home.error);
			const { directory, fileNames } = home.value;
			if (fileNames.length > 1)
				return err(
					new UsageError(
						`${directory} holds both ${CONFIG_FILE_NAMES.join(" and ")}; keep one.`
					)
				);
			return ok({
				home: directory,
				files: fileNames.map((name) => path.join(directory, name)),
				everyConfig: true,
				projects: new Map(),
				folders: [],
				homeConfig:
					fileNames.length === 1
						? path.join(directory, fileNames[0])
						: undefined,
			});
		}

		const homeConfig =
			home.isOk() && home.value.fileNames.length === 1
				? path.join(home.value.directory, home.value.fileNames[0])
				: undefined;
		const resolved: NamedConfig[] = [];
		for (const ref of refs) {
			const found = await this.configOf(
				path.resolve(cwd, ref),
				ref,
				homeConfig
			);
			if (found.isErr()) return err(found.error);
			resolved.push(found.value);
		}

		const files = resolved.map(({ file }) => file);
		const repeated = files.findIndex(
			(file, index) => files.indexOf(file) !== index
		);
		if (repeated >= 0) {
			return err(
				new UsageError(
					`"${refs[repeated]}" was named more than once; each config can ` +
						`only be built once per invocation.`
				)
			);
		}

		return ok({
			home: home.isOk() ? home.value.directory : cwd,
			files,
			everyConfig: false,
			projects: new Map(
				resolved.flatMap(({ file, project }) =>
					project === undefined ? [] : [[file, project]]
				)
			),
			folders: resolved.flatMap(({ folder }) =>
				folder === undefined ? [] : [folder]
			),
			homeConfig,
		});
	}

	/** What `target`, a path the user named as `ref`, stands for: a folder's config, a config file, the project a project file of a folder's config stands for, or else a project of the config here. */
	private async configOf(
		target: string,
		ref: string,
		homeConfig: string | undefined
	): Promise<Result<NamedConfig, Error>> {
		const base = path.basename(target);
		if (await this.fileSystemService.isDirectory(target)) {
			const config = await this.configIn(target, `"${ref}"`);
			if (config.isErr()) {
				const countsAsFolder = await this.fileSystemService.exists(
					path.join(target, DEFAULT_PROJECT_FILE)
				);
				return isBareName(ref) && homeConfig && !countsAsFolder
					? ok({ file: homeConfig, project: ref })
					: err(config.error);
			}
			return ok({
				file: config.value,
				...(isBareName(ref) ? { folder: ref } : {}),
			});
		}
		if (PROJECT_SUFFIXES.some((suffix) => base.endsWith(suffix))) {
			const stem = base.slice(0, base.indexOf(".project."));
			const config = await this.configIn(
				path.dirname(target),
				`"${ref}"`
			);
			if (config.isErr()) return err(config.error);
			return ok({
				file: config.value,
				...(stem === DEFAULT_PROJECT ? {} : { project: stem }),
			});
		}
		if (!(await this.fileSystemService.exists(target))) {
			if (isBareName(ref) && homeConfig)
				return ok({ file: homeConfig, project: ref });
			return err(
				new UsageError(
					`"${ref}" not found: name a folder with a rogen.json, a *.project.json path, or a project of the rogen.json here.`
				)
			);
		}
		return isConfigFileName(base)
			? ok({ file: target })
			: err(
					new UsageError(
						`"${ref}" is not a folder with a rogen.json, nor a *.project.json path.`
					)
				);
	}

	/** The config file in `directory`; an error when it holds none or both names. */
	private async configIn(
		directory: string,
		named: string
	): Promise<Result<string, Error>> {
		const names = await this.list(directory);
		if (names.length === 1) return ok(names[0]);
		return err(
			new UsageError(
				names.length === 0
					? `${named} holds no ${CONFIG_FILE_NAMES[0]} (${directory}). Run 'rogen init' to create one.`
					: `${directory} holds both ${CONFIG_FILE_NAMES.join(" and ")}; keep one.`
			)
		);
	}

	/** The config files directly in `directory`, as absolute paths; none when it can't be read. */
	async list(directory: string): Promise<string[]> {
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(directory)
		);
		return listing.isErr()
			? []
			: configFileNames(listing.value).map((name) =>
					path.join(directory, name)
				);
	}

	/** The folder configs are read from: the working directory when it has one, else the nearest folder above that does. */
	private async home(): Promise<Result<EnclosingConfigs, Error>> {
		const cwd = this.environmentService.cwd;
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(cwd)
		);
		if (listing.isErr()) {
			return err(
				new Error(
					`Could not look for a config file in ${cwd}: ${listing.error.message}`,
					{ cause: listing.error }
				)
			);
		}

		const fileNames = configFileNames(listing.value);
		if (fileNames.length > 0) return ok({ directory: cwd, fileNames });

		const enclosing = await this.findEnclosing();
		return enclosing
			? ok(enclosing)
			: err(
					new Error(
						`No ${CONFIG_FILE_NAMES[0]} found in ${cwd}. Run 'rogen init' to create one.`
					)
				);
	}

	/** The nearest parent of the working directory that has a config. */
	async findEnclosing(): Promise<EnclosingConfigs | undefined> {
		let directory = this.environmentService.cwd;
		for (;;) {
			const parent = path.dirname(directory);
			if (parent === directory) return undefined;
			directory = parent;
			const listing = await tryWithAsync(() =>
				this.fileSystemService.readDirectory(directory)
			);
			if (listing.isErr()) continue;
			const fileNames = configFileNames(listing.value);
			if (fileNames.length > 0) return { directory, fileNames };
		}
	}
}

function configFileNames(entries: readonly [string, FileType][]): string[] {
	return entries
		.filter(([name, type]) => isFileType(type) && isConfigFileName(name))
		.map(([name]) => name)
		.sort();
}
