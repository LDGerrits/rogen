import path from "path";
import { toPosix } from "../../../../base/path.js";
import { Diagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../../../config/config.js";
import { hasSyncedOutput } from "./nothing-emitted.js";
import { META_FILE_SUFFIX } from "../../../rojo/rojo-files.js";
import { MetaReplacement } from "../../../toolchain/toolchain.js";
import { ScannedRoot, SyncRule } from "../../build-record.js";
import { SyncDiagnostics } from "../../sync-diagnostics.js";
import {
	SyncLayout,
	emittedPath,
	isSynced,
	relativeToProject,
} from "../../layout/sync-path.js";
import { findUnclaimedMeta } from "../meta/unclaimed-meta.js";

export const metaNotSynced: SyncRule = (
	{ config, index, layout, roots },
	fileSystem
) =>
	checkSyncMeta(
		fileSystem,
		config,
		layout,
		roots,
		new Set(findUnclaimedMeta(index, roots).map(({ path }) => path))
	);

/**
 * Warns once for claimed meta with no copy under `syncDir`, skipping root
 * dirs `nothingEmitted` reports. `roots` is the build's scan, and `unclaimed`
 * the absolute POSIX paths of the meta no file claims, which Rojo ignores anyway.
 */
export async function checkSyncMeta(
	fileSystem: FileSystemService,
	config: Pick<ResolvedConfig, "outFile">,
	layout: SyncLayout,
	roots: readonly ScannedRoot[],
	unclaimed: ReadonlySet<string>
): Promise<Diagnostic[]> {
	if (!isSynced(layout)) return [];
	const { syncDir, projectDir } = layout;
	const replacements = layout.tools.flatMap(
		({ metaReplacement }) => metaReplacement ?? []
	);

	const missing: string[] = [];
	let converted = 0;
	let conversion: MetaReplacement | undefined;

	for (const root of roots) {
		if (!(await hasSyncedOutput(fileSystem, root.rootDir, layout)))
			continue;
		for (const metaFile of root.metaFiles) {
			const source = path.join(root.rootDir, metaFile);
			if (unclaimed.has(toPosix(source))) continue;
			const emitted = emittedPath(source, layout);
			if (await fileSystem.exists(emitted)) continue;
			missing.push(toPosix(source));
			const stem = emitted.slice(0, -META_FILE_SUFFIX.length);
			for (const replacement of replacements)
				if (await fileSystem.exists(`${stem}${replacement.suffix}`)) {
					conversion ??= replacement;
					if (replacement === conversion) converted++;
					break;
				}
		}
	}

	return missing.length > 0
		? [
				SyncDiagnostics.metaNotSynced(
					{ resource: config.outFile },
					relativeToProject(syncDir, projectDir) || ".",
					missing,
					conversion && { count: converted, ...conversion }
				),
			]
		: [];
}
