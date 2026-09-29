import path from "path";
import { toPosix } from "../../base/path.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { commonRoot } from "../config/common-root.js";

const CONFIG_FILES = [".darklua.json", ".darklua.json5"];

/**
 * Darklua, the one processor `init` sets up: it rewrites code into a folder
 * of its own, which becomes the sync dir. A language without a compiler has
 * Darklua read the root dirs themselves, so it also needs a project file
 * rooted at the source to resolve requires from.
 */
export const Darklua = {
	/** Where Darklua writes unless told otherwise. */
	defaultSyncDir: "dist",
	detectedHint: "found .darklua.json",

	async detect(fileSystem: FileSystemService, cwd: string): Promise<boolean> {
		const found = await Promise.all(
			CONFIG_FILES.map((file) => fileSystem.exists(path.join(cwd, file)))
		);
		return found.some(Boolean);
	},

	/**
	 * One `darklua process` per directory it reads. Each lands at its path
	 * relative to their common root, which is where the synced project points.
	 */
	processCommands(
		directory: string,
		sourceDirs: readonly string[],
		syncDir: string
	): string[] {
		const absolute = sourceDirs.map((dir) => path.resolve(directory, dir));
		const common = commonRoot(absolute);
		return sourceDirs.map((dir, index) => {
			const relative = toPosix(path.relative(common, absolute[index]));
			return `darklua process ${dir} ${relative ? `${syncDir}/${relative}` : syncDir}`;
		});
	},
};
