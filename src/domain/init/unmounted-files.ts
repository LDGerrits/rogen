import path from "path";
import { containsPosix, joinPosix, normalizeDir } from "../../base/path.js";
import { isGlobsetMatch } from "../../base/glob.js";
import { tryWithAsync } from "../../base/result.js";
import {
	FileReader,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";

/** The files of the source paths that no node of a hand-written project file mounts: Rojo ignores them, and routes place them. */
export class UnmountedFiles {
	constructor(
		private readonly reader: FileReader,
		private readonly directory: string
	) {}

	/** Folders relative to the project, sorted. `mounted` and `ignored` are the mounts and `globIgnorePaths` of the project file. */
	async find(
		sourcePaths: readonly string[],
		mounted: readonly string[],
		ignored: readonly string[]
	): Promise<string[]> {
		const roots = sourcePaths.map(normalizeDir);
		if (roots.some((root) => mounted.includes(root))) return [];
		const found: string[] = [];
		for (const root of roots)
			await this.walk(root, mounted, ignored, found);
		return found.sort();
	}

	private async walk(
		folder: string,
		mounted: readonly string[],
		ignored: readonly string[],
		found: string[]
	): Promise<void> {
		const listing = await tryWithAsync(() =>
			this.reader.readDirectory(path.join(this.directory, folder))
		);
		if (listing.isErr()) return;
		for (const [name, type] of listing.value) {
			const relative = joinPosix(folder, name);
			if (
				name === ".rogen-syncback" ||
				mounted.some((target) => containsPosix(target, relative)) ||
				ignored.some((glob) => isGlobsetMatch(relative, glob))
			)
				continue;
			if (isDirectoryType(type))
				await this.walk(relative, mounted, ignored, found);
			else if (
				isFileType(type) &&
				new RojoFile(name, SyncRules.DEFAULT).kind !== undefined
			)
				found.push(relative);
		}
	}
}
