import path from "path";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

interface PackageJson {
	version?: string;
}

export async function getVersion(
	fileSystemService: FileSystemService,
	startDir: string
): Promise<string> {
	try {
		const projectRoot = await findInternalPackageRoot(
			fileSystemService,
			startDir
		);
		if (!projectRoot) return "unknown";

		const packageJsonPath = path.join(projectRoot, "package.json");
		const pkg =
			await fileSystemService.readJson<PackageJson>(packageJsonPath);
		return pkg.version || "unknown";
	} catch {
		return "unknown";
	}
}

async function findInternalPackageRoot(
	fileSystemService: FileSystemService,
	startDir: string
): Promise<string | undefined> {
	let currentDir = startDir;

	while (currentDir !== path.dirname(currentDir)) {
		if (
			await fileSystemService.exists(
				path.join(currentDir, "package.json")
			)
		) {
			return currentDir;
		}
		currentDir = path.dirname(currentDir);
	}

	return undefined;
}
