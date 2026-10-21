import path from "path";
import { IoError, ProjectError, UsageError } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	FileReader,
	FileType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { projectFileName } from "../rojo/rojo-project.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_CONFIG_FILE_NAMES,
	DEFAULT_PROJECT,
	DEFAULT_PROJECT_FILES,
	LEGACY_CONFIG_FILE_NAMES,
	configStem,
	isConfigFileName,
	isDefaultConfigFileName,
	isProjectFileConfig,
} from "./config.js";
import { EnclosingConfigs } from "./config-service.js";
import { PlaceFinder } from "./place-finder.js";

export interface DiscoveredConfigs {
	/** The working directory, or the place folder it lies in. */
	readonly home: string;
	readonly files: readonly string[];
	readonly noneNamed: boolean;
	/** The place folders named or holding the working directory, by config file; a config named whole has no entry. */
	readonly scopes: ReadonlyMap<string, readonly string[]>;
	/** What picking had to say, such as a name matching both a folder and a file. */
	readonly notes: readonly string[];
}

interface NamedConfig {
	readonly file: string;
	readonly place?: string;
	readonly note?: string;
}

interface PlaceAround {
	readonly file: string;
	readonly place: string;
}

const notFound = (ref: string): ProjectError =>
	new ProjectError(
		`"${ref}" not found.`,
		`Name a folder with a ${DEFAULT_CONFIG_FILE}, a .rogen.json file, or a *.project.json path.`
	);

const keepOne = (directory: string, names: readonly string[]): UsageError =>
	new UsageError(`${directory} holds both ${names.join(" and ")}; keep one.`);

const isBareName = (ref: string): boolean =>
	ref !== "" && ref !== "." && ref !== ".." && ref === path.basename(ref);

/** Finds which config file a command reads: the one it names, else the default of the working directory. */
export class ConfigDiscovery {
	private readonly places: PlaceFinder;

	constructor(
		private readonly fileSystemService: FileReader,
		private readonly environmentService: EnvironmentService
	) {
		this.places = new PlaceFinder(fileSystemService);
	}

	/** The config files `refs` names (a folder, config file, `*.project.json` path or bare name), else the default of the working directory. Paths resolve from the working directory. */
	async discover(
		refs: readonly string[]
	): Promise<Result<DiscoveredConfigs, Error>> {
		const around = await this.placeAround();
		return refs.length === 0
			? this.discoverHere(around)
			: this.discoverNamed(refs, around);
	}

	private async discoverHere(
		around: PlaceAround | undefined
	): Promise<Result<DiscoveredConfigs, Error>> {
		if (around)
			return ok({
				home: around.place,
				files: [around.file],
				noneNamed: false,
				scopes: new Map([[around.file, [around.place]]]),
				notes: [],
			});
		const cwd = this.environmentService.cwd;
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(cwd)
		);
		if (listing.isErr())
			return err(
				new IoError(
					`Could not look for a config file in ${cwd}: ${listing.error.message}`,
					undefined,
					{ cause: listing.error }
				)
			);
		const file = await this.defaultIn(cwd, undefined);
		if (file.isErr()) return err(file.error);
		return ok({
			home: cwd,
			files: [file.value],
			noneNamed: true,
			scopes: new Map(),
			notes: [],
		});
	}

	/** Every config file of the working directory, from one directory read: no default is needed. A folder with none is `discover([])`'s. */
	async discoverFolder(): Promise<Result<DiscoveredConfigs, Error>> {
		const around = await this.placeAround();
		const cwd = this.environmentService.cwd;
		const files = around ? [] : await this.list(cwd);
		const twin = ConfigDiscovery.twinStem(files);
		if (twin !== undefined)
			return err(
				keepOne(
					cwd,
					files
						.filter((file) => configStem(file) === twin)
						.map((file) => path.basename(file))
				)
			);
		if (around || files.length === 0) return this.discoverHere(around);
		return ok({
			home: cwd,
			files,
			noneNamed: false,
			scopes: new Map(),
			notes: [],
		});
	}

	private static twinStem(files: readonly string[]): string | undefined {
		const stems = files.map((file) => configStem(file));
		return stems.find((stem, index) => stems.indexOf(stem) !== index);
	}

	private async discoverNamed(
		refs: readonly string[],
		around: PlaceAround | undefined
	): Promise<Result<DiscoveredConfigs, Error>> {
		const cwd = this.environmentService.cwd;
		const resolved: NamedConfig[] = [];
		for (const ref of refs) {
			const found = await this.configOf(path.resolve(cwd, ref), ref);
			if (found.isErr()) return err(found.error);
			resolved.push(found.value);
		}

		const merged = this.merge(resolved, refs);
		if (merged.isErr()) return err(merged.error);
		const { files, scopes } = merged.value;
		return ok({
			home: around?.place ?? cwd,
			files,
			noneNamed: false,
			scopes,
			notes: resolved.flatMap(({ note }) => note ?? []),
		});
	}

	private merge(
		resolved: readonly NamedConfig[],
		refs: readonly string[]
	): Result<{ files: string[]; scopes: Map<string, string[]> }, Error> {
		const files: string[] = [];
		const scopes = new Map<string, string[]>();
		for (const [index, named] of resolved.entries()) {
			const earlier = resolved
				.slice(0, index)
				.filter((before) => before.file === named.file);
			if (earlier.length === 0) files.push(named.file);
			for (const before of earlier) {
				if (
					before.place === named.place ||
					before.place === undefined ||
					named.place === undefined
				)
					return err(
						new UsageError(
							`"${refs[index]}" was named more than once; each config can ` +
								`only be built once per invocation.`
						)
					);
			}
			if (
				named.place !== undefined &&
				!scopes.get(named.file)?.includes(named.place)
			)
				scopes.set(named.file, [
					...(scopes.get(named.file) ?? []),
					named.place,
				]);
		}
		return ok({ files, scopes });
	}

	private async placeAround(): Promise<PlaceAround | undefined> {
		let directory = this.environmentService.cwd;
		for (;;) {
			const file = await this.places.rootOf(directory);
			if (file) return { file, place: directory };
			if ((await this.list(directory)).length > 0) return undefined;
			const parent = path.dirname(directory);
			if (parent === directory) return undefined;
			directory = parent;
		}
	}

	private async configOf(
		target: string,
		ref: string
	): Promise<Result<NamedConfig, Error>> {
		const base = path.basename(target);
		if (await this.fileSystemService.isDirectory(target))
			return this.folderRef(target, ref);
		if (isProjectFileConfig(target))
			return this.projectFileRef(target, base, ref);
		if (await this.fileSystemService.exists(target))
			return this.configFileRef(target, base, ref);
		if (!isBareName(ref)) return err(notFound(ref));
		const file = await this.fileNamed(this.environmentService.cwd, ref);
		if (file.isErr()) return err(file.error);
		return file.value ? ok({ file: file.value }) : err(notFound(ref));
	}

	private async folderRef(
		target: string,
		ref: string
	): Promise<Result<NamedConfig, Error>> {
		const folder = await this.folderDefault(target, ref);
		if (!isBareName(ref)) return folder;
		const file = await this.fileNamed(this.environmentService.cwd, ref);
		if (file.isErr() || !file.value) return folder;
		if (folder.isErr()) return ok({ file: file.value });
		const name = path.basename(file.value);
		return ok({
			...folder.value,
			note: `"${ref}" is a folder with a default config and also ${name}: using the folder. To use the file, name it: ${name}.`,
		});
	}

	private async folderDefault(
		target: string,
		ref: string
	): Promise<Result<NamedConfig, Error>> {
		const listing = await this.places.rootOf(target);
		if (listing) return ok({ file: listing, place: target });
		const config = await this.defaultIn(target, ref);
		return config.isOk() ? ok({ file: config.value }) : err(config.error);
	}

	private async projectFileRef(
		target: string,
		base: string,
		ref: string
	): Promise<Result<NamedConfig, Error>> {
		const stem = base.slice(0, base.indexOf(".project."));
		const folder = path.dirname(target);
		if (stem === DEFAULT_PROJECT) {
			const listing = await this.places.rootOf(folder);
			if (listing) return ok({ file: listing, place: folder });
		}
		const config = await this.configBeside(folder, stem);
		if (config.isErr()) return err(config.error);
		if (config.value) return ok({ file: config.value });
		// A project file with no config beside it is read as it is, as `rojo build test.project.json` reads it.
		return (await this.fileSystemService.isFile(target))
			? ok({ file: target })
			: err(notFound(ref));
	}

	private async configFileRef(
		target: string,
		base: string,
		ref: string
	): Promise<Result<NamedConfig, Error>> {
		if (!isConfigFileName(base))
			return err(
				new UsageError(
					`"${ref}" is not a folder with a ${DEFAULT_CONFIG_FILE}, a .rogen.json file, nor a *.project.json path.`
				)
			);
		const folder = path.dirname(target);
		const beside = await this.configBeside(folder, configStem(base)!);
		if (beside.isErr()) return err(beside.error);
		const listing = isDefaultConfigFileName(base)
			? await this.places.rootOf(folder)
			: undefined;
		return ok(
			listing ? { file: listing, place: folder } : { file: target }
		);
	}

	/** The config of `stem` in `folder`, when it has one. Both extensions of one stem fail. */
	private async configBeside(
		folder: string,
		stem: string
	): Promise<Result<string | undefined, Error>> {
		const present: string[] = [];
		for (const extension of ["json", "jsonc"]) {
			const file = path.join(folder, `${stem}.rogen.${extension}`);
			if (await this.fileSystemService.isFile(file)) present.push(file);
		}
		return present.length > 1
			? err(
					keepOne(
						folder,
						present.map((file) => path.basename(file))
					)
				)
			: ok(present[0]);
	}

	/** What a bare name stands for in `folder`: its config of that name, else its project file of that name. */
	private async fileNamed(
		folder: string,
		name: string
	): Promise<Result<string | undefined, Error>> {
		const config = await this.configBeside(folder, name);
		if (config.isErr() || config.value) return config;
		for (const suffix of ["", "c"]) {
			const file = path.join(folder, `${projectFileName(name)}${suffix}`);
			if (await this.fileSystemService.isFile(file)) return ok(file);
		}
		return ok(undefined);
	}

	/** The default of `directory`: its `default.rogen.json`, else the Rojo project file Rogen adopts. `named` is how the folder was named, when it was. */
	private async defaultIn(
		directory: string,
		named: string | undefined
	): Promise<Result<string, Error>> {
		const configs = await this.defaultConfigs(directory);
		if (configs.length > 1)
			return err(keepOne(directory, DEFAULT_CONFIG_FILE_NAMES));
		if (configs.length === 1) return ok(configs[0]);
		const adopted = await this.adoptable(directory);
		if (adopted) return ok(adopted);
		return err(await this.noDefault(directory, named));
	}

	private async noDefault(
		directory: string,
		named: string | undefined
	): Promise<ProjectError> {
		for (const name of LEGACY_CONFIG_FILE_NAMES)
			if (await this.fileSystemService.isFile(path.join(directory, name)))
				return new ProjectError(
					`${name} in ${directory} is not read any more: a config is named for the project file it writes.`,
					`Rename it to ${DEFAULT_CONFIG_FILE}.`
				);
		const others = (await this.list(directory)).map((file) =>
			path.basename(file)
		);
		const where = named === undefined ? "this folder" : `"${named}"`;
		const holds =
			others.length > 0 ? ` It holds ${others.join(", ")}.` : "";
		return new ProjectError(
			`No ${DEFAULT_CONFIG_FILE} or ${DEFAULT_PROJECT}.project.json in ${where} (${directory}).${holds}`,
			others.length > 0
				? `Name one of them, or run 'rogen init' to create ${DEFAULT_CONFIG_FILE}.`
				: "Run 'rogen init' to create one."
		);
	}

	/** The default configs of a folder, absolute and sorted: one, or two when it holds both extensions. */
	async defaultConfigs(directory: string): Promise<string[]> {
		return (await this.list(directory)).filter((file) =>
			isDefaultConfigFileName(path.basename(file))
		);
	}

	/** Every config file of a folder, absolute and sorted; none when it can't be read. */
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

	/** The Rojo project file of a folder with no config: Rogen reads it as a config whose output is itself, and writes nothing. */
	async adoptable(directory: string): Promise<string | undefined> {
		for (const name of DEFAULT_PROJECT_FILES) {
			const file = path.join(directory, name);
			if (await this.fileSystemService.isFile(file)) return file;
		}
		return undefined;
	}

	/** The nearest folder above `from`, the working directory unless given, with a default config. */
	async findEnclosing(
		from = this.environmentService.cwd
	): Promise<EnclosingConfigs | undefined> {
		let directory = from;
		for (;;) {
			const parent = path.dirname(directory);
			if (parent === directory) return undefined;
			directory = parent;
			const fileNames = (await this.defaultConfigs(directory)).map(
				(file) => path.basename(file)
			);
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
