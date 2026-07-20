import path from "path";
import { FileType, FileSystemService } from "./file-system-service.js";
import { toPosix } from "../../base/path.js";

/**
 * Recursively walks a directory and returns a map of entries.
 */
export async function walkDirectory(
	fileSystemService: FileSystemService,
	dir: string,
	listings = new Map<string, [string, FileType][]>()
): Promise<Map<string, [string, FileType][]>> {
	try {
		const entries = await fileSystemService.readDirectory(dir);
		listings.set(dir, entries);

		const subdirs = entries
			.filter(([_, type]) => type === FileType.Directory)
			.map(([name]) => toPosix(path.join(dir, name)));

		await Promise.all(
			subdirs.map((subdir) =>
				walkDirectory(fileSystemService, subdir, listings)
			)
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
