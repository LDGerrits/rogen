import path from "path";
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

	/** The scripts under `dir`, as paths below it, up to `limit`; a hidden or vendored folder is not entered. */
	async codeFilesIn(dir: string, limit = 50): Promise<string[]> {
		const found: string[] = [];
		const visit = async (current: string, below: string) => {
			let entries;
			try {
				entries = await this.fileReader.readDirectory(current);
			} catch {
				return;
			}
			for (const [name, type] of entries
				.filter(([entry]) => !isHiddenOrVendored(entry))
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
				if (found.length >= limit) return;
				const shown = below === "" ? name : `${below}/${name}`;
				if (isDirectoryType(type))
					await visit(path.join(current, name), shown);
				else if (
					isFileType(type) &&
					new RojoFile(name, SyncRules.DEFAULT).kind === "script"
				)
					found.push(shown);
			}
		};
		await visit(dir, "");
		return found;
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
