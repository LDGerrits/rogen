import path from "path";
import { toPosix } from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../config/config.js";
import { commonRoot } from "../config/common-root.js";
import { hasSyncedOutput } from "./check-sync-dir.js";
import { META_FILE_SUFFIX, ScannedRoot } from "./root-scanner.js";
import { SyncDiagnostics } from "./sync-diagnostics.js";
import { emittedPath, relativeToProject } from "./sync-path.js";

/**
 * Warns once for claimed meta with no copy under `syncDir`, skipping root
 * dirs `checkSyncDir` reports. `roots` is the build's scan, and `unclaimed`
 * the absolute POSIX paths of the meta no file claims, which Rojo ignores anyway.
 */
export async function checkSyncMeta(
	fileSystem: FileSystemService,
	config: Pick<ResolvedConfig, "rootDirs" | "syncDir" | "outFile">,
	roots: readonly ScannedRoot[],
	unclaimed: ReadonlySet<string>
): Promise<Diagnostic[]> {
	const { syncDir } = config;
	if (!syncDir) return [];

	const projectDir = path.dirname(config.outFile);
	const common = commonRoot(config.rootDirs);
	const missing: string[] = [];
	let converted = 0;

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
				SyncDiagnostics.metaNotSynced(
					{ resource: config.outFile },
					relativeToProject(syncDir, projectDir) || ".",
					missing,
					converted
				),
			]
		: [];
}
