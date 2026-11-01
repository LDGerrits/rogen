import path from "path";
import { containsPosix, joinPosix } from "../../base/path.js";
import {
	FileReader,
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { DEFAULT_SOURCE_PATH } from "../config/config.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { DetectedWorkspace } from "../toolchain/toolchain.js";
import { ROJO_TEMPLATE_NODES } from "./starter-project.js";

export interface DirectoryLayout {
	readonly codeFolders: readonly string[];
	/** The code folders with an init module at their top, which Rojo reads as one module. */
	readonly moduleFolders?: readonly string[];
	/** The scripts at the top of the folder that Rojo reads, outside every code folder. */
	readonly rootScripts?: readonly string[];
	/** The folders of Rojo's place template that hold code, such as `src/server`, when `src` holds code only in them. */
	readonly templateFolders?: readonly string[];
}

const TEMPLATE_FOLDERS = Object.keys(ROJO_TEMPLATE_NODES);

/** The init files Rojo reads as a module, which a model's folder is. */
const MODULE_INITS = ["init.luau", "init.lua"];

const isScript = (name: string): boolean =>
	new RojoFile(name, SyncRules.DEFAULT).kind === "script";

/** A script Rojo syncs itself, leaving out what only a compiler reads. */
const isRojoScript = (name: string): boolean => {
	const file = new RojoFile(name, SyncRules.DEFAULT);
	return file.kind === "script" && file.isSyncedByRojo;
};

const isCompiledScript = (name: string): boolean =>
	isScript(name) && !isRojoScript(name);

const isHiddenOrVendored = (name: string): boolean =>
	name.startsWith(".") || name === "node_modules";

export class CodeFinder {
	constructor(private readonly fileReader: FileReader) {}

	/** Excludes the folders the toolchain uses for packages and compiled code. */
	async layoutOf(
		cwd: string,
		workspace: DetectedWorkspace
	): Promise<DirectoryLayout> {
		const codeFolders = await this.codeFoldersIn(cwd, [
			...workspace.packageDirs,
			...workspace.languages.flatMap(
				({ reservedFolders }) => reservedFolders
			),
		]);
		const holdsModule = await Promise.all(
			codeFolders.map((folder) =>
				this.holdsModule(path.join(cwd, folder))
			)
		);
		return {
			codeFolders,
			rootScripts: (await this.entriesOf(cwd))
				.filter(
					([name, type]) =>
						isFileType(type) &&
						!isHiddenOrVendored(name) &&
						isRojoScript(name)
				)
				.map(([name]) => name)
				.sort(),
			moduleFolders: codeFolders.filter((_, at) => holdsModule[at]),
			templateFolders: codeFolders.includes(DEFAULT_SOURCE_PATH)
				? await this.templateFoldersIn(cwd)
				: [],
		};
	}

	private async holdsModule(dir: string): Promise<boolean> {
		const entries = await this.entriesOf(dir);
		return entries.some(
			([name, type]) => isFileType(type) && MODULE_INITS.includes(name)
		);
	}

	/** The folders of Rojo's template in `src`, when they hold all of its code and it is code Rojo syncs itself, not a compiler's. */
	private async templateFoldersIn(cwd: string): Promise<string[]> {
		const source = path.join(cwd, DEFAULT_SOURCE_PATH);
		if (await this.holdsCode(source, isCompiledScript)) return [];
		const entries = await this.entriesOf(source);
		const visible = entries.filter(([name]) => !isHiddenOrVendored(name));
		if (visible.some(([name, type]) => isFileType(type) && isScript(name)))
			return [];
		const folders = visible
			.filter(([, type]) => isDirectoryType(type))
			.map(([name]) => name);
		const holding = await Promise.all(
			folders.map((name) =>
				this.holdsCode(path.join(cwd, DEFAULT_SOURCE_PATH, name))
			)
		);
		const code = folders.filter((_, at) => holding[at]);
		if (
			code.length === 0 ||
			!code.every((name) => TEMPLATE_FOLDERS.includes(name.toLowerCase()))
		)
			return [];
		return TEMPLATE_FOLDERS.flatMap((template) =>
			code
				.filter((name) => name.toLowerCase() === template)
				.map((name) => joinPosix(DEFAULT_SOURCE_PATH, name))
		);
	}

	private async entriesOf(dir: string): Promise<[string, FileType][]> {
		try {
			return await this.fileReader.readDirectory(dir);
		} catch {
			return [];
		}
	}

	/** `script`: what counts as code, any script by default. */
	async holdsCode(dir: string, script = isScript): Promise<boolean> {
		let entries;
		try {
			entries = await this.fileReader.readDirectory(dir);
		} catch {
			return false;
		}
		const visible = entries.filter(([name]) => !isHiddenOrVendored(name));
		if (visible.some(([name, type]) => isFileType(type) && script(name)))
			return true;
		for (const [name, type] of visible)
			if (
				isDirectoryType(type) &&
				(await this.holdsCode(path.join(dir, name), script))
			)
				return true;
		return false;
	}

	/** Goes down only into folders above a held one, so each stray folder is named once, at its top. */
	async codeOutside(
		cwd: string,
		held: readonly string[],
		excluded: readonly string[],
		folder = "."
	): Promise<string[]> {
		if (held.includes(".")) return [];
		let entries;
		try {
			entries = await this.fileReader.readDirectory(
				path.join(cwd, folder)
			);
		} catch {
			return [];
		}
		const found: string[] = [];
		for (const [name, type] of entries) {
			const relative = joinPosix(folder, name);
			if (
				isHiddenOrVendored(name) ||
				[...held, ...excluded].some((dir) =>
					containsPosix(dir, relative)
				)
			)
				continue;
			if (isDirectoryType(type)) {
				if (held.some((dir) => containsPosix(relative, dir)))
					found.push(
						...(await this.codeOutside(
							cwd,
							held,
							excluded,
							relative
						))
					);
				else if (await this.holdsCode(path.join(cwd, relative)))
					found.push(relative);
			} else if (isFileType(type) && isScript(name)) found.push(relative);
		}
		return found.sort();
	}

	private async codeFoldersIn(
		cwd: string,
		excluded: readonly string[]
	): Promise<string[]> {
		let entries;
		try {
			entries = await this.fileReader.readDirectory(cwd);
		} catch {
			return [];
		}
		const candidates = entries
			.filter(
				([name, type]) =>
					isDirectoryType(type) &&
					!isHiddenOrVendored(name) &&
					!excluded.includes(name)
			)
			.map(([name]) => name);
		const holding = await Promise.all(
			candidates.map((name) => this.holdsCode(path.join(cwd, name)))
		);
		return candidates.filter((_, index) => holding[index]).sort();
	}
}
