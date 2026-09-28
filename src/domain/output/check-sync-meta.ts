import path from "path";
import { toPosix } from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { META_FILE_SUFFIX, scanRootDirs } from "../build/root-scanner.js";
import {
	commonRoot,
	emittedPath,
	relativeToProject,
} from "../build/sync-path.js";
import { findUnclaimedMeta } from "../build/unclaimed-meta.js";
import { hasSyncedOutput } from "./check-sync-dir.js";
import { OutputDiagnostics } from "./output-diagnostics.js";

/** Warns once for claimed meta with no copy under `syncDir`, skipping root dirs `checkSyncDir` reports. */
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
	let converted = 0;

	const { roots } = scanRootDirs(index, config);
	const unclaimed = new Set(
		findUnclaimedMeta(index, roots).map(({ path }) => path)
	);
	for (const root of roots) {
		if (!(await hasSyncedOutput(fileSystem, root.rootDir, common, syncDir)))
			continue;
		for (const metaFile of root.metaFiles) {
			const source = path.join(root.rootDir, metaFile);
			if (unclaimed.has(toPosix(source))) continue;
			const emitted = emittedPath(source, common, syncDir);
			if (await fileSystem.exists(emitted)) continue;
			missing.push(toPosix(source));
			if (
				await fileSystem.exists(
					`${emitted.slice(0, -META_FILE_SUFFIX.length)}.meta.lua`
				)
			)
				converted++;
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
