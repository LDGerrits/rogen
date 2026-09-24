import path from "path";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	FileSystemService,
	FileType,
} from "../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../config/config.js";
import {
	commonRoot,
	emittedPath,
	relativeToProject,
} from "../build/sync-path.js";
import { OutputDiagnostics } from "./output-diagnostics.js";

/** Warns once per root dir whose top-level entries have no emitted counterpart under `syncDir`. */
export async function checkSyncDir(
	fileSystem: FileSystemService,
	config: Pick<ResolvedConfig, "rootDirs" | "syncDir" | "outFile">
): Promise<Diagnostic[]> {
	const { syncDir } = config;
	if (!syncDir) return [];

	const projectDir = path.dirname(config.outFile);
	const shown = (target: string) =>
		relativeToProject(target, projectDir) || ".";
	const common = commonRoot(config.rootDirs);
	const warnings: Diagnostic[] = [];

	for (const rootDir of config.rootDirs) {
		if (!(await fileSystem.isDirectory(rootDir))) continue;

		const emitted = (await fileSystem.readDirectory(rootDir))
			.filter(([name]) => !name.startsWith("."))
			.map(([name]) =>
				emittedPath(path.join(rootDir, name), common, syncDir)
			);
		if (emitted.length === 0 || (await anyExists(fileSystem, emitted)))
			continue;

		const expected = path.join(syncDir, path.relative(common, rootDir));
		const found = await findShifted(fileSystem, syncDir, emitted[0]);
		warnings.push(
			OutputDiagnostics.nothingEmitted(
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
			if (type & FileType.Directory)
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
	let current = target;
	while (
		!(await fileSystem.exists(current)) &&
		path.dirname(current) !== current
	)
		current = path.dirname(current);
	return current;
}
