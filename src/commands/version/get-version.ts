import path from "path";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

interface PackageJson {
	version?: string;
}

/**
 * Walks up from `startDir` looking for the nearest `package.json` and
 * returns its `version`, or `"unknown"` if none is found or it can't be
 * read.
 */
export async function getVersion(
	fileSystemService: FileSystemService,
	startDir: string
): Promise<string> {
	try {
		let currentDir = startDir;

		for (;;) {
			const packageJsonPath = path.join(currentDir, "package.json");

			if (await fileSystemService.exists(packageJsonPath)) {
				const pkg =
					await fileSystemService.readJson<PackageJson>(
						packageJsonPath
					);
				return pkg.version || "unknown";
			}

			const parentDir = path.dirname(currentDir);
			if (parentDir === currentDir) break; // reached the filesystem root
			currentDir = parentDir;
		}

		return "unknown";
	} catch {
		return "unknown";
	}
}
