import path from "path";
import {
	FileReader,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo.js";
import { DetectedWorkspace } from "../toolchain/toolchain.js";

/** Where a repo that builds several places keeps each place's own code. */
export const PLACES_DIR = "places";

/** The folder a project keeps its code in unless it says otherwise. */
export const SOURCE_DIR = "src";

/** The folders of a directory that hold code. */
export interface DirectoryLayout {
	/** Top-level folders holding Luau or TypeScript code, sorted. */
	readonly codeFolders: readonly string[];
	/** The folders directly inside `places/`, sorted. */
	readonly places: readonly string[];
}

const isHiddenOrVendored = (name: string): boolean =>
	name.startsWith(".") || name === "node_modules";

/** Finds the code a directory holds. */
export class CodeFinder {
	constructor(private readonly fileReader: FileReader) {}

	/** The code folders and places of `cwd`; the folders the toolchain finds `workspace` uses for packages and compiled code are not code. */
	async layoutOf(
		cwd: string,
		workspace: DetectedWorkspace
	): Promise<DirectoryLayout> {
		const places = await this.placesIn(path.join(cwd, PLACES_DIR));
		const codeFolders = await this.codeFoldersIn(cwd, [
			...workspace.packageDirs,
			...workspace.languages.flatMap(
				({ reservedFolders }) => reservedFolders
			),
			...(places.length > 0 ? [PLACES_DIR] : []),
		]);
		return { codeFolders, places };
	}

	/** Whether `dir` holds a script anywhere below it, outside hidden and vendored folders. */
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

	private async placesIn(dir: string): Promise<string[]> {
		try {
			return (await this.fileReader.readDirectory(dir))
				.filter(
					([name, type]) =>
						isDirectoryType(type) && !isHiddenOrVendored(name)
				)
				.map(([name]) => name)
				.sort();
		} catch {
			return [];
		}
	}
}
