import path from "path";
import { FileType, IFileSystem } from "./file-system.js";
import { toPosix } from "../../base/path.js";

/**
 * Recursively walks a directory and returns a map of entries.
 */
export async function walkDirectory(
	fs: IFileSystem,
	dir: string,
	listings = new Map<string, [string, FileType][]>()
): Promise<Map<string, [string, FileType][]>> {
	try {
		const entries = await fs.readDirectory(dir);
		listings.set(dir, entries);

		const subdirs = entries
			.filter(([_, type]) => type === FileType.Directory)
			.map(([name]) => toPosix(path.join(dir, name)));

		await Promise.all(
			subdirs.map((subdir) => walkDirectory(fs, subdir, listings))
		);

		return listings;
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return listings;
		}
		throw error;
	}
}
