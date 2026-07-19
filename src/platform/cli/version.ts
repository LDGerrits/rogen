import { createRequire } from "module";
import path from "path";
import * as fs from "fs";

export function getVersion(): string {
	try {
		const require = createRequire(import.meta.url);

		const projectRoot = findInternalPackageRoot(import.meta.dirname);
		const packageJsonPath = path.join(projectRoot, "package.json");

		const pkg = require(packageJsonPath);
		return pkg.version || "unknown";
	} catch {
		return "unknown";
	}
}

function findInternalPackageRoot(startDir: string): string {
	let currentDir = startDir;

	while (currentDir !== path.dirname(currentDir)) {
		if (fs.existsSync(path.join(currentDir, "package.json"))) {
			return currentDir;
		}
		currentDir = path.dirname(currentDir);
	}

	return startDir;
}
