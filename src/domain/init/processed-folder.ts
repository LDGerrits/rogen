import path from "path";
import {
	commonFolderPosix,
	containsPosix,
	isBelowPosix,
	joinPosix,
	normalizeDir,
} from "../../base/path.js";
import { tryWithAsync } from "../../base/result.js";
import { FileReader } from "../../platform/fs/file-system-service.js";

/** The folder a processor such as Darklua writes, found as the one a hand-written project file mounts and that repeats the layout of the source paths. */
export class ProcessedFolder {
	constructor(
		private readonly reader: FileReader,
		private readonly directory: string
	) {}

	/** Only a single match counts, since two folders that both repeat the source can't be told apart. */
	async find(
		sourcePaths: readonly string[],
		mounted: readonly string[],
		taken: readonly string[] = []
	): Promise<string | undefined> {
		const roots = sourcePaths.map(normalizeDir);
		if (roots.length === 0) return undefined;
		const common = commonFolderPosix(roots);
		const claimed = [...roots, ...taken.map(normalizeDir)];
		const byTop = new Map<string, string[]>();
		for (const target of mounted.map(normalizeDir)) {
			const top = target.split("/")[0];
			if (
				!isBelowPosix(top) ||
				claimed.some(
					(dir) =>
						containsPosix(dir, target) || containsPosix(top, dir)
				)
			)
				continue;
			byTop.set(top, [...(byTop.get(top) ?? []), target]);
		}
		const mirrors: string[] = [];
		for (const [top, targets] of byTop) {
			const mirrored = await Promise.all(
				targets.map((target) => this.mirrors(top, target, common))
			);
			if (mirrored.every(Boolean)) mirrors.push(top);
		}
		return mirrors.length === 1 ? mirrors[0] : undefined;
	}

	/** Whether `target` in `top` has its counterpart in `common`; a mount of the whole folder must also share a name with it, which a package folder doesn't. */
	private async mirrors(
		top: string,
		target: string,
		common: string
	): Promise<boolean> {
		const rest = path.posix.relative(top, target);
		const counterpart = rest === "" ? common : joinPosix(common, rest);
		if (!(await this.reader.exists(this.at(counterpart)))) return false;
		if (rest !== "") return true;
		const [own, theirs] = await Promise.all(
			[top, common].map(async (folder) => {
				const listing = await tryWithAsync(() =>
					this.reader.readDirectory(this.at(folder))
				);
				return listing.isOk()
					? listing.value.map(([name]) => name)
					: [];
			})
		);
		return own.some((name) => theirs.includes(name));
	}

	private at(relative: string): string {
		return path.join(this.directory, relative);
	}
}
