import path from "path";
import { ancestors } from "../../../../base/path.js";
import { Diagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import {
	FileSystemService,
	isDirectoryType,
} from "../../../../platform/fs/file-system-service.js";
import { SyncRule } from "../../build-record.js";
import { SyncDiagnostics } from "../../sync-diagnostics.js";
import {
	SyncLayout,
	SyncedLayout,
	emittedPath,
	isSynced,
	relativeToProject,
} from "../../layout/sync-path.js";

export const nothingEmitted: SyncRule = ({ config, layout }, fileSystem) =>
	checkSyncDir(fileSystem, config.rootDirs, layout);

/** Warns once per root dir whose top-level entries have no emitted counterpart under `syncDir`. */
export async function checkSyncDir(
	fileSystem: FileSystemService,
	rootDirs: readonly string[],
	layout: SyncLayout
): Promise<Diagnostic[]> {
	if (!isSynced(layout)) return [];
	const { syncDir, projectDir, commonRoot: common } = layout;

	const shown = (target: string) =>
		relativeToProject(target, projectDir) || ".";
	const warnings: Diagnostic[] = [];

	for (const rootDir of rootDirs) {
		const emitted = await topLevelEmitted(fileSystem, rootDir, layout);
		if (emitted.length === 0 || (await anyExists(fileSystem, emitted)))
			continue;

		const expected = path.join(syncDir, path.relative(common, rootDir));
		const found = await findShifted(fileSystem, syncDir, emitted[0]);
		warnings.push(
			SyncDiagnostics.nothingEmitted(
				{ resource: rootDir },
				shown(rootDir),
				shown(expected),
				found
					? { found: true, path: shown(found) }
					: {
							found: false,
							path: shown(
								await nearestExisting(fileSystem, expected)
							),
						}
			)
		);
	}
	return warnings;
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

/** Skips dot-files, which are mostly markers a compiler never emits. */
async function topLevelEmitted(
	fileSystem: FileSystemService,
	rootDir: string,
	layout: SyncedLayout
): Promise<string[]> {
	if (!(await fileSystem.isDirectory(rootDir))) return [];
	return (await fileSystem.readDirectory(rootDir))
		.filter(([name]) => !name.startsWith("."))
		.map(([name]) => emittedPath(path.join(rootDir, name), layout));
}

async function anyExists(
	fileSystem: FileSystemService,
	paths: readonly string[]
): Promise<boolean> {
	for (const target of paths)
		if (await fileSystem.exists(target)) return true;
	return false;
}

/** Looks for `emitted` one level up or down from where it was expected, the way a shifted common root moves it. */
async function findShifted(
	fileSystem: FileSystemService,
	syncDir: string,
	emitted: string
): Promise<string | undefined> {
	const segments = path.relative(syncDir, emitted).split(path.sep);
	const candidates = segments
		.slice(1)
		.map((_, index) => path.join(syncDir, ...segments.slice(index + 1)));

	if (await fileSystem.isDirectory(syncDir)) {
		for (const [name, type] of await fileSystem.readDirectory(syncDir))
			if (isDirectoryType(type))
				candidates.push(path.join(syncDir, name, ...segments));
	}

	for (const candidate of candidates)
		if (await fileSystem.exists(candidate)) return candidate;
	return undefined;
}

async function nearestExisting(
	fileSystem: FileSystemService,
	target: string
): Promise<string> {
	const chain = [target, ...ancestors(target)];
	for (const dir of chain) if (await fileSystem.exists(dir)) return dir;
	return chain[chain.length - 1];
}
