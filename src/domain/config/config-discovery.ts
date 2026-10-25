import path from "path";
import { Disposable, toDisposable } from "../../base/disposable.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { IoError, ProjectError, UsageError } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	FileReader,
	FileType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { isProjectFileName, projectFileName } from "../rojo/rojo-project.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_CONFIG_FILE_NAMES,
	DEFAULT_PROJECT,
	DEFAULT_PROJECT_FILES,
	configStem,
	isConfigFileName,
	isDefaultConfigFileName,
	isProjectFileConfig,
	isSyncbackFileName,
	projectStem,
} from "./config.js";
import {
	ConfigCover,
	ConfigFolderCheck,
	EnclosingConfigs,
} from "./config-service.js";

export interface DiscoveredConfigs {
	/** The working directory. */
	readonly home: string;
	readonly files: readonly string[];
	readonly noneNamed: boolean;
	/** What picking had to say, such as a name matching both a folder and a file. */
	readonly notes: readonly string[];
}

interface NamedConfig {
	readonly file: string;
	readonly note?: string;
}

const notFound = (ref: string): ProjectError =>
	new ProjectError(
		`"${ref}" not found.`,
		`Name a folder with a ${DEFAULT_CONFIG_FILE}, a .rogen.json file, or a *.project.json path.`
	);

const keepOne = (directory: string, names: readonly string[]): ProjectError =>
	new ProjectError(
		`${directory} holds both ${names.join(" and ")}.`,
		"Keep one of them: both write the same project file."
	);

const isBareName = (ref: string): boolean =>
	ref !== "" && ref !== "." && ref !== ".." && ref === path.basename(ref);

/** Finds which config file a command reads: the one it names, else the default of the working directory. */
export class ConfigDiscovery {
	private readonly folderChecks = new Set<ConfigFolderCheck>();

	constructor(
		private readonly fileSystemService: FileReader,
		private readonly environmentService: EnvironmentService
	) {}

	registerFolderCheck(check: ConfigFolderCheck): Disposable {
		this.folderChecks.add(check);
		return toDisposable(() => this.folderChecks.delete(check));
	}

	async staleConfigsIn(folder: string): Promise<readonly Diagnostic[]> {
		const found: Diagnostic[] = [];
		for (const check of this.folderChecks)
			found.push(...(await check(folder, this.fileSystemService)));
		return found;
	}

	/** The config files `refs` names, else the default of the working directory, as Rojo finds its project file. */
	async discover(
		refs: readonly string[]
	): Promise<Result<DiscoveredConfigs, Error>> {
		return refs.length === 0
			? this.discoverHere()
			: this.discoverNamed(refs);
	}

	private async discoverHere(): Promise<Result<DiscoveredConfigs, Error>> {
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
			notes: [],
		});
	}

	private async discoverNamed(
		refs: readonly string[]
	): Promise<Result<DiscoveredConfigs, Error>> {
		const cwd = this.environmentService.cwd;
		const resolved: NamedConfig[] = [];
		for (const ref of refs) {
			const found = await this.configOf(path.resolve(cwd, ref), ref);
			if (found.isErr()) return err(found.error);
			resolved.push(found.value);
		}

		const files: string[] = [];
		for (const [index, { file }] of resolved.entries()) {
			if (files.includes(file))
				return err(
					new UsageError(
						`"${refs[index]}" was named more than once; each config can only be built once per invocation.`
					)
				);
			files.push(file);
		}
		return ok({
			home: cwd,
			files,
			noneNamed: false,
			notes: resolved.flatMap(({ note }) => note ?? []),
		});
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
		const config = await this.defaultIn(target, ref);
		return config.isOk() ? ok({ file: config.value }) : err(config.error);
	}

	private async projectFileRef(
		target: string,
		base: string,
		ref: string
	): Promise<Result<NamedConfig, Error>> {
		const folder = path.dirname(target);
		const config = await this.configBeside(folder, projectStem(base));
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
		return ok({ file: target });
	}

	/** The config of `stem` in `folder`; both extensions of one stem fail, as the two would write one file. */
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

	/** The file a bare `ref` names here, as `build` reads it. */
	async fileNamedHere(
		ref: string
	): Promise<Result<string | undefined, Error>> {
		return isBareName(ref)
			? this.fileNamed(this.environmentService.cwd, ref)
			: ok(undefined);
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

	/** The default of `directory`: its config, else the plain project file Rogen adopts; `named` words the error. */
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
		const stale = await this.staleConfigsIn(directory);
		if (stale.length > 0)
			return new ProjectError(
				stale
					.map(
						(found) =>
							`${path.basename(found.resource)} in ${directory}: ${found.message}`
					)
					.join("\n")
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
				? named === undefined
					? "Name one of them, or run 'rogen write' to write them all."
					: "Name one of them."
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

	/** The project files of a folder that no config writes, absolute and sorted. */
	async plainProjects(directory: string): Promise<string[]> {
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(directory)
		);
		if (listing.isErr()) return [];
		const written = new Set(
			(await this.list(directory)).map((file) => configStem(file))
		);
		return listing.value
			.filter(
				([name, type]) =>
					isFileType(type) &&
					isProjectFileName(name) &&
					!isSyncbackFileName(name) &&
					!written.has(projectStem(name))
			)
			.map(([name]) => path.join(directory, name))
			.sort();
	}

	/** The Rojo project file of a folder with no config: Rogen reads it as a config whose output is itself, and writes nothing. */
	async adoptable(directory: string): Promise<string | undefined> {
		for (const name of DEFAULT_PROJECT_FILES) {
			const file = path.join(directory, name);
			if (await this.fileSystemService.isFile(file)) return file;
		}
		return undefined;
	}

	/** The config that answers for `target`: the default of the nearest folder above a path, so an agent hook can check from the root. */
	async coverOf(target: string): Promise<ConfigCover | undefined> {
		if (isConfigFileName(path.basename(target)))
			return (await this.fileSystemService.isFile(target))
				? { file: target, whole: true }
				: undefined;
		if (
			isProjectFileConfig(target) &&
			(await this.fileSystemService.isFile(target))
		) {
			const named = await this.projectFileRef(
				target,
				path.basename(target),
				target
			);
			return {
				file: named.isOk() ? named.value.file : target,
				whole: true,
			};
		}
		let directory = (await this.fileSystemService.isDirectory(target))
			? target
			: path.dirname(target);
		for (;;) {
			const [config] = await this.defaultConfigs(directory);
			const file = config ?? (await this.adoptable(directory));
			if (file) return { file, whole: false };
			const parent = path.dirname(directory);
			if (parent === directory) return undefined;
			directory = parent;
		}
	}

	/** Every named config in the folder of `target` and in each folder above it, nearest folder first: the candidates for a path no default config answers for. */
	async namedConfigsAbove(target: string): Promise<string[]> {
		let directory = (await this.fileSystemService.isDirectory(target))
			? target
			: path.dirname(target);
		const found: string[] = [];
		for (;;) {
			found.push(
				...(await this.list(directory)).filter(
					(file) => !isDefaultConfigFileName(path.basename(file))
				)
			);
			const parent = path.dirname(directory);
			if (parent === directory) return found;
			directory = parent;
		}
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
