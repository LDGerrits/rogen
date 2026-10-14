import path from "path";
import { compareStrings } from "../../base/collections.js";
import { isMatch } from "../../base/glob.js";
import { toPosix } from "../../base/path.js";
import { tryWithAsync } from "../../base/result.js";
import {
	FileReader,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";

/** The folders a `placePaths` list names. */
export class PlaceFolders {
	/** The folders under `root` that any of `globs` matches, once each, sorted by path. A name starting with a dot, and `node_modules`, are never entered. */
	static async find(
		files: FileReader,
		root: string,
		globs: readonly string[]
	): Promise<string[]> {
		const found = new Set<string>();
		for (const glob of globs) {
			const segments = toPosix(glob)
				.split("/")
				.filter((segment) => segment !== "" && segment !== ".");
			if (segments.length === 0) continue;
			await PlaceFolders.walk(files, root, segments, found);
		}
		return [...found].sort((a, b) =>
			compareStrings(toPosix(a), toPosix(b))
		);
	}

	private static async walk(
		files: FileReader,
		directory: string,
		segments: readonly string[],
		found: Set<string>
	): Promise<void> {
		if (segments.length === 0) {
			found.add(directory);
			return;
		}
		const [segment, ...rest] = segments;
		if (segment === "**") {
			await PlaceFolders.walk(files, directory, rest, found);
			for (const child of await PlaceFolders.children(files, directory))
				await PlaceFolders.walk(
					files,
					path.join(directory, child),
					segments,
					found
				);
			return;
		}
		if (!/[()[\]{}*?!+@]/.test(segment)) {
			const child = path.join(directory, segment);
			if (await files.isDirectory(child))
				await PlaceFolders.walk(files, child, rest, found);
			return;
		}
		for (const child of await PlaceFolders.children(files, directory))
			if (isMatch(child, segment))
				await PlaceFolders.walk(
					files,
					path.join(directory, child),
					rest,
					found
				);
	}

	private static async children(
		files: FileReader,
		directory: string
	): Promise<string[]> {
		const listing = await tryWithAsync(() =>
			files.readDirectory(directory)
		);
		return listing.isErr()
			? []
			: listing.value
					.filter(
						([name, type]) =>
							isDirectoryType(type) &&
							!name.startsWith(".") &&
							name !== "node_modules"
					)
					.map(([name]) => name);
	}
}
