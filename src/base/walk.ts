import path from "path";
import fs from "fs";

export interface IDirectoryReader {
	readDir(dir: string): Promise<fs.Dirent[]>;
}

/**
 * Generates a map of paths linked to directory entry.
 * Missing directory paths are ignored.
 */
export async function walkDirectory(
	fsReader: IDirectoryReader,
	dir: string,
	listings = new Map<string, fs.Dirent[]>()
): Promise<Map<string, fs.Dirent[]>> {
	try {
		const entries = await fsReader.readDir(dir);
		listings.set(dir, entries);

		const subdirs = entries
			.filter((e) => e.isDirectory())
			.map((e) => path.join(dir, e.name));

		await Promise.all(
			subdirs.map((subdir) => walkDirectory(fsReader, subdir, listings))
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
