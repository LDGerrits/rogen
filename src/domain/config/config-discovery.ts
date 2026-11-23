import path from "path";
import {
	isInside,
	samePath,
	selfAndAncestors,
	toPosix,
} from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { IoError, ProjectError, UsageError } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo.js";
import {
	RojoProject,
	isProjectFileName,
	projectFileName,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_CONFIG_FILE_NAMES,
	DEFAULT_PROJECT,
	configStem,
	isConfigFileName,
	isDefaultConfigFileName,
	isProjectFileConfig,
	PLACES_FOLDER,
	compilerOwnerStem,
	isCompilerFileName,
	isSyncbackFileName,
	projectStem,
} from "./config.js";
import { ConfigCover, ConfigFolderCheck } from "./config-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

export interface DiscoveredConfigs {
	readonly home: string;
	readonly files: readonly string[];
	readonly noneNamed: boolean;
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

const PROJECT_ROOT_MARKERS = [".git", "rokit.toml"];

const isBareName = (ref: string): boolean =>
	ref !== "" && ref !== "." && ref !== ".." && ref === path.basename(ref);

export class ConfigDiscovery {
	constructor(
		private readonly checks: ReadonlySet<ConfigFolderCheck>,
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@EnvironmentService
		private readonly environmentService: EnvironmentService
	) {}

	async staleConfigsIn(folder: string): Promise<readonly Diagnostic[]> {
		const found: Diagnostic[] = [];
		for (const check of [...this.checks])
			found.push(...(await check(folder, this.fileSystemService)));
		return found;
	}

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
		const folder = (await this.defaultIn(target, ref)).map((file) => ({
			file,
		}));
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

	private async projectFileRef(
		target: string,
		base: string,
		ref: string
	): Promise<Result<NamedConfig, Error>> {
		const folder = path.dirname(target);
		const config = await this.configBeside(folder, projectStem(base));
		if (config.isErr()) return err(config.error);
		if (config.value) return ok({ file: config.value });
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

	async fileNamedHere(
		ref: string
	): Promise<Result<string | undefined, Error>> {
		return isBareName(ref)
			? this.fileNamed(this.environmentService.cwd, ref)
			: ok(undefined);
	}

	async stemReads(
		folder: string,
		stem: string,
		file: string
	): Promise<boolean> {
		const named = isConfigFileName(file)
			? await this.configBeside(folder, stem)
			: await this.fileNamed(folder, stem);
		return (
			named.isOk() &&
			(named.value === undefined || samePath(named.value, file))
		);
	}

	async namesConfig(ref: string): Promise<boolean> {
		const target = path.resolve(this.environmentService.cwd, ref);
		const isDirectory = await this.fileSystemService.isDirectory(target);
		if (isDirectory && (await this.defaultConfigs(target)).length > 0)
			return true;
		if (isDirectory && (await this.adoptable(target)) !== undefined)
			return true;
		if (
			!isDirectory &&
			(isConfigFileName(target) || isProjectFileConfig(target))
		)
			return true;
		if (
			!isBareName(ref) ||
			(!isDirectory && (await this.fileSystemService.exists(target)))
		)
			return false;
		const file = await this.fileNamed(this.environmentService.cwd, ref);
		return file.isErr() || file.value !== undefined;
	}

	private async fileNamed(
		folder: string,
		name: string
	): Promise<Result<string | undefined, Error>> {
		const config = await this.configBeside(folder, name);
		if (config.isErr() || config.value) return config;
		if (await this.writesCompilerFile(folder, projectFileName(name)))
			return ok(undefined);
		for (const suffix of ["", "c"]) {
			const file = path.join(folder, `${projectFileName(name)}${suffix}`);
			if (await this.fileSystemService.isFile(file)) return ok(file);
		}
		return ok(undefined);
	}

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
		const files = (await this.list(directory)).map((file) =>
			path.basename(file)
		);
		const places = await this.places(directory);
		const others = [...files, ...places];
		const where = named === undefined ? "this folder" : `"${named}"`;
		const holds =
			others.length > 0 ? ` It holds ${others.join(", ")}.` : "";
		return new ProjectError(
			`No ${DEFAULT_CONFIG_FILE} or ${DEFAULT_PROJECT}.project.json in ${where} (${directory}).${holds}`,
			others.length > 0
				? named === undefined && files.length > 0
					? "Name one of them, or run 'rogen write' to write them all."
					: "Name one of them."
				: "Run 'rogen init' to create one."
		);
	}

	private async places(directory: string): Promise<string[]> {
		const places: string[] = [];
		for (const place of await this.subfolders(
			path.join(directory, PLACES_FOLDER)
		))
			if ((await this.defaultConfigs(place)).length > 0)
				places.push(toPosix(path.relative(directory, place)));
		return places.sort();
	}

	async defaultConfigs(directory: string): Promise<string[]> {
		return (await this.list(directory)).filter((file) =>
			isDefaultConfigFileName(path.basename(file))
		);
	}

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

	async plainProjects(directory: string): Promise<string[]> {
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(directory)
		);
		if (listing.isErr()) return [];
		const written = new Set(
			(await this.list(directory)).map((file) => configStem(file))
		);
		const plain: string[] = [];
		for (const [name, type] of listing.value)
			if (
				isFileType(type) &&
				isProjectFileName(name) &&
				!isSyncbackFileName(name) &&
				!written.has(projectStem(name)) &&
				!(await this.writesCompilerFile(directory, name))
			)
				plain.push(path.join(directory, name));
		return plain.sort();
	}

	private async writesCompilerFile(
		folder: string,
		fileName: string
	): Promise<boolean> {
		if (!isCompilerFileName(fileName)) return false;
		const stem = compilerOwnerStem(fileName);
		const owner = await this.configBeside(folder, stem);
		return owner.isErr() || owner.value !== undefined;
	}

	async adoptable(directory: string): Promise<string | undefined> {
		for (const name of RojoFile.DEFAULT_PROJECTS) {
			const file = path.join(directory, name);
			if (await this.fileSystemService.isFile(file)) return file;
		}
		return undefined;
	}

	async writersNestedIn(projectFile: string): Promise<string[]> {
		const writers: string[] = [];
		const read = new Set<string>();
		const visit = async (file: string): Promise<void> => {
			if (read.has(file)) return;
			read.add(file);
			const text = await tryWithAsync(() =>
				this.fileSystemService.readFile(file)
			);
			const project = text.isOk()
				? RojoProject.parse(text.value)
				: undefined;
			if (!project?.isOk()) return;
			for (const mounted of project.value.mountedPaths()) {
				const target = path.resolve(
					path.dirname(file),
					rojoPathTarget(mounted.path)
				);
				const nested = await this.nestedAt(target);
				if (nested?.kind === "plain") await visit(nested.file);
				else if (nested && !writers.includes(nested.file))
					writers.push(nested.file);
			}
		};
		await visit(projectFile);
		return writers;
	}

	private async nestedAt(
		target: string
	): Promise<{ kind: "config" | "plain"; file: string } | undefined> {
		if (await this.fileSystemService.isDirectory(target)) {
			const [config] = await this.defaultConfigs(target);
			if (config) return { kind: "config", file: config };
			const plain = await this.adoptable(target);
			return plain ? { kind: "plain", file: plain } : undefined;
		}
		const base = path.basename(target);
		if (!isProjectFileName(base)) return undefined;
		const config = await this.configBeside(
			path.dirname(target),
			projectStem(base)
		);
		if (config.isOk() && config.value)
			return { kind: "config", file: config.value };
		return (await this.fileSystemService.isFile(target))
			? { kind: "plain", file: target }
			: undefined;
	}

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
		for (const directory of await this.foldersUp(target)) {
			const [config] = await this.defaultConfigs(directory);
			const file = config ?? (await this.adoptable(directory));
			if (file) return { file, whole: false };
		}
		return undefined;
	}

	async namedConfigsAbove(target: string, stop: string): Promise<string[]> {
		const found: string[] = [];
		for (const directory of await this.foldersUp(target))
			found.push(
				...(await this.list(directory)).filter(
					(file) => !isDefaultConfigFileName(path.basename(file))
				)
			);
		for (const directory of await this.foldersWithin(target, stop))
			for (const child of await this.subfolders(directory))
				found.push(...(await this.defaultConfigs(child)));
		return found;
	}

	async configsBeside(target: string, stop: string): Promise<string[]> {
		const found: string[] = [];
		for (const directory of await this.foldersWithin(target, stop))
			for (const child of await this.subfolders(directory))
				if (!samePath(child, target) && !isInside(target, child))
					found.push(...(await this.list(child)));
		return found;
	}

	private async foldersWithin(
		target: string,
		stop: string
	): Promise<string[]> {
		const folders = await this.foldersUp(target);
		for (const [index, folder] of folders.entries())
			for (const marker of PROJECT_ROOT_MARKERS)
				if (
					await this.fileSystemService.exists(
						path.join(folder, marker)
					)
				)
					return folders.slice(0, index + 1);
		const stopAt = folders.findIndex((folder) => samePath(folder, stop));
		return stopAt < 0 ? folders : folders.slice(0, stopAt + 1);
	}

	private async subfolders(directory: string): Promise<string[]> {
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(directory)
		);
		return (listing.isOk() ? listing.value : [])
			.filter(
				([name, type]) =>
					isDirectoryType(type) &&
					!name.startsWith(".") &&
					name !== "node_modules"
			)
			.map(([name]) => path.join(directory, name));
	}

	private async foldersUp(target: string): Promise<string[]> {
		const start = (await this.fileSystemService.isDirectory(target))
			? target
			: path.dirname(target);
		return [...selfAndAncestors(start)];
	}
}

function configFileNames(entries: readonly [string, FileType][]): string[] {
	return entries
		.filter(([name, type]) => isFileType(type) && isConfigFileName(name))
		.map(([name]) => name)
		.sort();
}
