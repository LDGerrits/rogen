import path from "path";
import { containsPosix, joinPosix } from "../../base/path.js";
import {
	FileReader,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { DetectedWorkspace } from "../toolchain/toolchain.js";

export interface DirectoryLayout {
	readonly codeFolders: readonly string[];
}

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
		return { codeFolders };
	}

	async holdsCode(dir: string): Promise<boolean> {
		let entries;
		try {
			entries = await this.fileReader.readDirectory(dir);
		} catch {
			return false;
		}
		const visible = entries.filter(([name]) => !isHiddenOrVendored(name));
		if (
			visible.some(
				([name, type]) =>
					isFileType(type) &&
					new RojoFile(name, SyncRules.DEFAULT).kind === "script"
			)
		)
			return true;
		for (const [name, type] of visible)
			if (
				isDirectoryType(type) &&
				(await this.holdsCode(path.join(dir, name)))
			)
				return true;
		return false;
	}

	/** The shallowest folders and files of code, relative to `cwd` and sorted, that no folder of `held` holds and none of `excluded` is; `.` in `held` holds everything. */
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
			} else if (
				isFileType(type) &&
				new RojoFile(name, SyncRules.DEFAULT).kind === "script"
			)
				found.push(relative);
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
