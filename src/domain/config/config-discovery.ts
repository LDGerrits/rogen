import path from "path";
import { IoError, ProjectError, UsageError } from "../../base/errors.js";
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
	DEFAULT_PROJECT_FILES,
	PROJECT_NAME,
	isConfigFileName,
} from "./config.js";
import { isProjectFileName } from "../rojo/rojo-project.js";
import { EnclosingConfigs, NamedProjects } from "./config-service.js";
import { PlaceFinder } from "./place-finder.js";

interface DiscoveredConfigs {
	/** The working directory, or the nearest folder above it with a config. */
	readonly home: string;
	readonly files: readonly string[];
	readonly noneNamed: boolean;
	/** The projects each config was named for, by config file. */
	readonly projects: ReadonlyMap<string, NamedProjects>;
	/** The bare names that are also a folder with a config. */
	readonly folders: readonly string[];
	/** The config of `home`, which a bare project name belongs to. */
	readonly homeConfig: string | undefined;
	/** The place folders named or holding the working directory, by config file; a config named whole has no entry. */
	readonly scopes: ReadonlyMap<string, readonly string[]>;
}

interface NamedConfig {
	readonly file: string;
	readonly project?: string;
	readonly folderName?: string;
	readonly place?: string;
}

interface PlaceAround {
	readonly file: string;
	readonly place: string;
}

const isBareName = (ref: string): boolean => PROJECT_NAME.test(ref);

const notFound = (ref: string): UsageError =>
	new UsageError(
		`"${ref}" not found.`,
		"Name a folder with a rogen.json, a *.project.json path, or a project of the rogen.json here."
	);

/** Finds which config files a command reads: in the working directory, else in the nearest folder above that has one. */
export class ConfigDiscovery {
	private readonly places: PlaceFinder;

	constructor(
		private readonly fileSystemService: FileReader,
		private readonly environmentService: EnvironmentService
	) {
		this.places = new PlaceFinder(fileSystemService);
	}

	/** The config files `refs` names (a folder, config file, `*.project.json` path or project name), else those of the folder found. Paths resolve from the working directory. */
	async discover(
		refs: readonly string[]
	): Promise<Result<DiscoveredConfigs, Error>> {
		const around = await this.placeAround();
		const home = await this.home();
		return refs.length === 0
			? this.discoverHere(around, home)
			: this.discoverNamed(refs, around, home);
	}

	private discoverHere(
		around: PlaceAround | undefined,
		home: Result<EnclosingConfigs, Error>
	): Result<DiscoveredConfigs, Error> {
		if (around)
			return ok({
				home: around.place,
				files: [around.file],
				noneNamed: false,
				projects: new Map(),
				folders: [],
				homeConfig: around.file,
				scopes: new Map([[around.file, [around.place]]]),
			});
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
			noneNamed: true,
			projects: new Map(),
			folders: [],
			homeConfig: this.configOfHome(home),
			scopes: new Map(),
		});
	}

	private async discoverNamed(
		refs: readonly string[],
		around: PlaceAround | undefined,
		home: Result<EnclosingConfigs, Error>
	): Promise<Result<DiscoveredConfigs, Error>> {
		const cwd = this.environmentService.cwd;
		const homeConfig = around ? around.file : this.configOfHome(home);
		const resolved: NamedConfig[] = [];
		for (const ref of refs) {
			const found = await this.configOf(
				path.resolve(cwd, ref),
				ref,
				homeConfig,
				around?.place
			);
			if (found.isErr()) return err(found.error);
			resolved.push(found.value);
		}

		const merged = this.merge(resolved, refs);
		if (merged.isErr()) return err(merged.error);
		const { files, projects, scopes } = merged.value;
		return ok({
			home: around?.place ?? (home.isOk() ? home.value.directory : cwd),
			files,
			noneNamed: false,
			projects,
			folders: resolved.flatMap(({ folderName }) =>
				folderName === undefined ? [] : [folderName]
			),
			homeConfig,
			scopes,
		});
	}

	private configOfHome(
		home: Result<EnclosingConfigs, Error>
	): string | undefined {
		return home.isOk() && home.value.fileNames.length === 1
			? path.join(home.value.directory, home.value.fileNames[0])
			: undefined;
	}

	private merge(
		resolved: readonly NamedConfig[],
		refs: readonly string[]
	): Result<
		{
			files: string[];
			projects: Map<string, NamedProjects>;
			scopes: Map<string, string[]>;
		},
		Error
	> {
		const files: string[] = [];
		const scopes = new Map<string, string[]>();
		for (const [index, named] of resolved.entries()) {
			const earlier = resolved
				.slice(0, index)
				.map((before, at) => ({ before, at }))
				.filter(({ before }) => before.file === named.file);
			if (earlier.length === 0) files.push(named.file);
			for (const { before, at } of earlier) {
				const samePlace = before.place === named.place;
				const sameProject = before.project === named.project;
				if (!samePlace && !sameProject)
					return err(
						new UsageError(
							`"${refs[at]}" and "${refs[index]}" name different projects of one config, and a project named applies to every place named.`,
							"Name the same project for each place, or run the command once per place."
						)
					);
				if (
					sameProject &&
					(samePlace ||
						before.place === undefined ||
						named.place === undefined)
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
		const projects = new Map<string, NamedProjects>();
		for (const file of files) {
			const forFile = resolved.filter((named) => named.file === file);
			const names = [
				...new Set(
					forFile.flatMap(({ project }) =>
						project === undefined ? [] : [project]
					)
				),
			];
			if (names.length > 0)
				projects.set(file, {
					names,
					usual: forFile.some(({ project }) => project === undefined),
				});
		}
		return ok({ files, projects, scopes });
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
		ref: string,
		homeConfig: string | undefined,
		homePlace: string | undefined
	): Promise<Result<NamedConfig, Error>> {
		const inHome = (project: string): NamedConfig => ({
			file: homeConfig as string,
			project,
			...(homePlace !== undefined && { place: homePlace }),
		});
		const base = path.basename(target);
		if (await this.fileSystemService.isDirectory(target))
			return this.folderRef(target, ref, homeConfig ? inHome : undefined);
		if (isProjectFileName(base))
			return this.projectFileRef(target, base, ref);
		if (!(await this.fileSystemService.exists(target))) {
			if (isBareName(ref) && homeConfig) return ok(inHome(ref));
			return err(notFound(ref));
		}
		return this.configFileRef(target, base, ref);
	}

	private async folderRef(
		target: string,
		ref: string,
		projectHere: ((project: string) => NamedConfig) | undefined
	): Promise<Result<NamedConfig, Error>> {
		const config = await this.configIn(
			target,
			`"${ref}"`,
			projectHere === undefined
		);
		const folder = isBareName(ref) ? { folderName: ref } : {};
		const listing = await this.places.rootOf(target);
		if (listing) return ok({ file: listing, place: target, ...folder });
		if (config.isOk()) return ok({ file: config.value, ...folder });
		const countsAsFolder =
			!isBareName(ref) || (await this.adoptable(target)) !== undefined;
		return projectHere && !countsAsFolder
			? ok(projectHere(ref))
			: err(config.error);
	}

	private async projectFileRef(
		target: string,
		base: string,
		ref: string
	): Promise<Result<NamedConfig, Error>> {
		const stem = base.slice(0, base.indexOf(".project."));
		const project = stem === DEFAULT_PROJECT ? {} : { project: stem };
		const folder = path.dirname(target);
		const listing = await this.places.rootOf(folder);
		if (listing) return ok({ file: listing, place: folder, ...project });
		const config = await this.configIn(
			folder,
			`"${ref}"`,
			stem === DEFAULT_PROJECT
		);
		if (config.isOk()) return ok({ file: config.value, ...project });
		// A Rojo project file of any name, in a folder with no config, is read as it is, as `rojo build test.project.json` reads it.
		if ((await this.list(folder)).length > 0) return err(config.error);
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
					`"${ref}" is not a folder with a rogen.json, nor a *.project.json path.`
				)
			);
		const folder = path.dirname(target);
		const listing = await this.places.rootOf(folder);
		return ok(
			listing ? { file: listing, place: folder } : { file: target }
		);
	}

	/** `adopt` lets a folder with only a Rojo project file stand in for a config. */
	private async configIn(
		directory: string,
		named: string,
		adopt = true
	): Promise<Result<string, Error>> {
		const names = await this.list(directory);
		if (names.length === 1) return ok(names[0]);
		const adopted =
			adopt && names.length === 0
				? await this.adoptable(directory)
				: undefined;
		if (adopted) return ok(adopted);
		return err(
			names.length === 0
				? new UsageError(
						`${named} holds no ${CONFIG_FILE_NAMES[0]} (${directory}).`,
						"Run 'rogen init' to create one."
					)
				: new UsageError(
						`${directory} holds both ${CONFIG_FILE_NAMES.join(" and ")}; keep one.`
					)
		);
	}

	/** Absolute paths; none when the folder can't be read. */
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

	private async home(): Promise<Result<EnclosingConfigs, Error>> {
		const cwd = this.environmentService.cwd;
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(cwd)
		);
		if (listing.isErr()) {
			return err(
				new IoError(
					`Could not look for a config file in ${cwd}: ${listing.error.message}`,
					undefined,
					{ cause: listing.error }
				)
			);
		}

		const fileNames = configFileNames(listing.value);
		if (fileNames.length > 0) return ok({ directory: cwd, fileNames });

		const enclosing =
			(await this.findEnclosing()) ?? (await this.findAdoptable());
		return enclosing
			? ok(enclosing)
			: err(
					new ProjectError(
						`No ${CONFIG_FILE_NAMES[0]} found in ${cwd}.`,
						"Run 'rogen init' to create one."
					)
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

	/** The nearest folder, the working directory included, with a Rojo project file; looked for only when no folder above holds a config. */
	async findAdoptable(
		from = this.environmentService.cwd
	): Promise<EnclosingConfigs | undefined> {
		let directory = from;
		for (;;) {
			const adopted = await this.adoptable(directory);
			if (adopted)
				return { directory, fileNames: [path.basename(adopted)] };
			const parent = path.dirname(directory);
			if (parent === directory) return undefined;
			directory = parent;
		}
	}

	async findEnclosing(
		from = this.environmentService.cwd
	): Promise<EnclosingConfigs | undefined> {
		let directory = from;
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
