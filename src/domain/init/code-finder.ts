import path from "path";
import { containsPosix, joinPosix } from "../../base/path.js";
import {
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { DEFAULT_SOURCE_PATH } from "../config/config.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { DetectedWorkspace } from "../toolchain/toolchain.js";
import { ROJO_TEMPLATE_NODES } from "./starter-project.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

export interface DirectoryLayout {
	readonly codeFolders: readonly string[];
	readonly moduleFolders: readonly string[];
	readonly rootScripts: readonly string[];
	readonly templateFolders: readonly string[];
}

const TEMPLATE_FOLDERS = Object.keys(ROJO_TEMPLATE_NODES);

const isScript = (name: string): boolean =>
	new RojoFile(name, SyncRules.DEFAULT).kind === "script";

const isRojoScript = (name: string): boolean => {
	const file = new RojoFile(name, SyncRules.DEFAULT);
	return file.kind === "script" && file.isSyncedByRojo;
};

const isModuleInit = (name: string): boolean => {
	const file = new RojoFile(name, SyncRules.DEFAULT);
	return file.isInit && file.isLuauModule;
};

const isCompiledScript = (name: string): boolean =>
	isScript(name) && !isRojoScript(name);

const isHiddenOrVendored = (name: string): boolean =>
	name.startsWith(".") || name === "node_modules";

export class CodeFinder {
	constructor(
		@FileSystemService private readonly fileReader: FileSystemService
	) {}

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
			([name, type]) => isFileType(type) && isModuleInit(name)
		);
	}

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

	async holdsCode(dir: string, script = isScript): Promise<boolean> {
		const entries = await this.entriesOf(dir);
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

	async keySpellings(
		cwd: string,
		dirs: readonly string[],
		keys: readonly string[]
	): Promise<Map<string, string>> {
		const given = new Map(keys.map((key) => [key.toLowerCase(), key]));
		const counts = new Map<string, Map<string, number>>();
		const note = (token: string) => {
			const key = token.toLowerCase();
			if (!given.has(key)) return;
			const spelled = counts.get(key) ?? new Map<string, number>();
			spelled.set(token, (spelled.get(token) ?? 0) + 1);
			counts.set(key, spelled);
		};
		const visit = async (dir: string): Promise<void> => {
			for (const [name, type] of await this.entriesOf(dir)) {
				if (isHiddenOrVendored(name)) continue;
				const at = /@([A-Za-z][A-Za-z0-9]*)(?:\.[^@]*)?$/.exec(name);
				if (at) note(at[1]);
				if (isDirectoryType(type)) {
					note(name.replace(/^\((.*)\)$/, "$1"));
					await visit(path.join(dir, name));
				}
			}
		};
		for (const dir of dirs) await visit(path.join(cwd, dir));
		return new Map(
			[...counts].map(([key, spelled]) => {
				const most = Math.max(...spelled.values());
				const tied = [...spelled]
					.filter(([, count]) => count === most)
					.map(([spelling]) => spelling);
				const preferred = given.get(key)!;
				return [key, tied.includes(preferred) ? preferred : tied[0]];
			})
		);
	}

	async codeOutside(
		cwd: string,
		held: readonly string[],
		excluded: readonly string[],
		folder = "."
	): Promise<string[]> {
		if (held.includes(".")) return [];
		const entries = await this.entriesOf(path.join(cwd, folder));
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
		const entries = await this.entriesOf(cwd);
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
