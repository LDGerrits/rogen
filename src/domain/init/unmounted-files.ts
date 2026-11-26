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
	FileSystemService,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";

const holds = (target: string, place: string): boolean =>
	target === "." || containsPosix(target, place);

export class UnmountedFiles {
	constructor(
		private readonly directory: string,
		@FileSystemService private readonly reader: FileSystemService
	) {}

	async find(
		sourcePaths: readonly string[],
		mounted: readonly string[],
		ignored: readonly string[],
		compiled: readonly string[]
	): Promise<string[]> {
		const roots = sourcePaths.map(normalizeDir);
		const common = commonFolderPosix(roots);
		const isMounted = (place: string) =>
			mounted.some((target) => holds(target, place));
		const compiledCopiesOf = (relative: string) =>
			compiled.map((folder) =>
				joinPosix(
					normalizeDir(folder),
					path.posix.relative(common, relative)
				)
			);
		const countsAsMounted = (relative: string) =>
			isMounted(relative) || compiledCopiesOf(relative).some(isMounted);
		const found: string[] = [];
		for (const root of roots)
			if (!isMounted(root))
				found.push(
					...(await this.walk(root, countsAsMounted, ignored)).paths
				);
		return found.map(literalGlob).sort();
	}

	private async walk(
		folder: string,
		countsAsMounted: (relative: string) => boolean,
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
			if (countsAsMounted(relative)) whole = false;
			else if (isDirectoryType(type)) {
				const inside = await this.walk(
					relative,
					countsAsMounted,
					ignored
				);
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
