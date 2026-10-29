import path from "path";
import {
	commonFolderPosix,
	containsPosix,
	joinPosix,
	normalizeDir,
} from "../../base/path.js";
import { ignoringGlob } from "../../base/glob.js";
import { tryWithAsync } from "../../base/result.js";
import {
	FileReader,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";

/** Whether a mount of `target` holds `place`; `.` is the project's folder, which holds everything. */
const holds = (target: string, place: string): boolean =>
	target === "." || containsPosix(target, place);

/** The files of the source paths that no node of a hand-written project file mounts: Rojo ignores them, and routes place them. */
export class UnmountedFiles {
	constructor(
		private readonly reader: FileReader,
		private readonly directory: string
	) {}

	/** A file whose compiled copy is mounted counts as mounted, since Rojo synced that copy. */
	async find(
		sourcePaths: readonly string[],
		mounted: readonly string[],
		ignored: readonly string[],
		compiled: readonly string[] = []
	): Promise<string[]> {
		const roots = sourcePaths.map(normalizeDir);
		const common = commonFolderPosix(roots);
		const mountedAt = (relative: string) =>
			[
				relative,
				...compiled.map((folder) =>
					joinPosix(
						normalizeDir(folder),
						path.posix.relative(common, relative)
					)
				),
			].some((place) => mounted.some((target) => holds(target, place)));
		const found: string[] = [];
		for (const root of roots)
			if (!mounted.some((target) => holds(target, root)))
				await this.walk(root, mountedAt, ignored, found);
		return found.sort();
	}

	private async walk(
		folder: string,
		mountedAt: (relative: string) => boolean,
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
				mountedAt(relative) ||
				ignoringGlob(relative, ignored) !== undefined
			)
				continue;
			if (isDirectoryType(type))
				await this.walk(relative, mountedAt, ignored, found);
			else if (
				isFileType(type) &&
				new RojoFile(name, SyncRules.DEFAULT).kind !== undefined
			)
				found.push(relative);
		}
	}
}
