import path from "path";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { scanRootDirs } from "../build/root-scanner.js";
import {
	commonRoot,
	emittedPath,
	relativeToProject,
} from "../build/sync-path.js";
import { hasSyncedOutput } from "./check-sync-dir.js";
import { OutputDiagnostics } from "./output-diagnostics.js";

const META_JSON = /\.meta\.json$/i;

/**
 * Warns once for the root dirs' `.meta.json` files that have no copy under
 * `syncDir`. Root dirs with no output there at all are `checkSyncDir`'s to report.
 */
export async function checkSyncMeta(
	fileSystem: FileSystemService,
	index: IndexService,
	config: Pick<ResolvedConfig, "rootDirs" | "exclude" | "syncDir" | "outFile">
): Promise<Diagnostic[]> {
	const { syncDir } = config;
	if (!syncDir) return [];

	const projectDir = path.dirname(config.outFile);
	const common = commonRoot(config.rootDirs);
	const missing: string[] = [];
	let converted = false;

	const { roots } = scanRootDirs(index, config);
	for (const root of roots) {
		if (!(await hasSyncedOutput(fileSystem, root.rootDir, common, syncDir)))
			continue;
		for (const metaFile of root.metaFiles) {
			const source = path.join(root.rootDir, metaFile);
			const emitted = emittedPath(source, common, syncDir);
			if (await fileSystem.exists(emitted)) continue;
			missing.push(relativeToProject(source, projectDir));
			converted ||= await fileSystem.exists(
				emitted.replace(META_JSON, ".meta.lua")
			);
		}
	}

	return missing.length > 0
		? [
				OutputDiagnostics.metaNotSynced(
					{ resource: config.outFile },
					relativeToProject(syncDir, projectDir) || ".",
					missing,
					converted
				),
			]
		: [];
}
