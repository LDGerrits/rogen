import path from "path";
import { FileSystemService } from "../../../../platform/fs/file-system-service.js";
import { SyncedLayout, emittedPath } from "../../layout/sync-path.js";

/** Skips dot-files, which are mostly markers a compiler never emits. */
export async function topLevelEmitted(
	fileSystem: FileSystemService,
	rootDir: string,
	layout: SyncedLayout
): Promise<string[]> {
	if (!(await fileSystem.isDirectory(rootDir))) return [];
	return (await fileSystem.readDirectory(rootDir))
		.filter(([name]) => !name.startsWith("."))
		.map(([name]) => emittedPath(path.join(rootDir, name), layout));
}

export async function anyExists(
	fileSystem: FileSystemService,
	paths: readonly string[]
): Promise<boolean> {
	for (const target of paths)
		if (await fileSystem.exists(target)) return true;
	return false;
}

/** Whether any top-level entry of `rootDir` has its emitted counterpart under `syncDir`. */
export async function hasSyncedOutput(
	fileSystem: FileSystemService,
	rootDir: string,
	layout: SyncedLayout
): Promise<boolean> {
	return anyExists(
		fileSystem,
		await topLevelEmitted(fileSystem, rootDir, layout)
	);
}
