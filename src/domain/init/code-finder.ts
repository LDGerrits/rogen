import path from "path";
import {
	FileReader,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo.js";
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
					isFileType(type) && new RojoFile(name).kind === "script"
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
