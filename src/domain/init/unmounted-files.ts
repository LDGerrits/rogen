import path from "path";
import {
	commonFolderPosix,
	containsPosix,
	joinPosix,
	normalizeDir,
} from "../../base/path.js";
import { ignoringGlob, literalGlob } from "../../base/glob.js";
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

/** The files of the source paths that no node of a hand-written project file mounts: Rojo ignores them, and routes would place them. */
export class UnmountedFiles {
	constructor(
		private readonly reader: FileReader,
		private readonly directory: string
	) {}

	/** Each as a glob that matches only it: a folder where nothing is mounted, else the file. A file whose compiled copy is mounted counts as mounted, since Rojo synced that copy. */
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
				found.push(
					...(await this.walk(root, mountedAt, ignored)).paths
				);
		return found.map(literalGlob).sort();
	}

	/** `whole`: nothing in `folder` is mounted, so `paths` can be the folder itself. */
	private async walk(
		folder: string,
		mountedAt: (relative: string) => boolean,
		ignored: readonly string[]
	): Promise<{ whole: boolean; paths: string[] }> {
		const listing = await tryWithAsync(() =>
			this.reader.readDirectory(path.join(this.directory, folder))
		);
		if (listing.isErr()) return { whole: false, paths: [] };
		let whole = true;
		const paths: string[] = [];
		for (const [name, type] of listing.value) {
			const relative = joinPosix(folder, name);
			if (
				name === ".rogen-syncback" ||
				ignoringGlob(relative, ignored) !== undefined
			)
				continue;
			if (mountedAt(relative)) whole = false;
			else if (isDirectoryType(type)) {
				const inside = await this.walk(relative, mountedAt, ignored);
				if (inside.whole) paths.push(relative);
				else {
					whole = false;
					paths.push(...inside.paths);
				}
			} else if (
				isFileType(type) &&
				new RojoFile(name, SyncRules.DEFAULT).kind !== undefined
			)
				paths.push(relative);
		}
		return { whole, paths };
	}
}
