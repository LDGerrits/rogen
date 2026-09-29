import path from "path";
import { ancestors } from "../../../../base/path.js";
import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import {
	FileSystemService,
	isDirectoryType,
} from "../../../../platform/fs/file-system-service.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { isSynced, relativeToProject } from "../../layout/sync-path.js";
import { Extensions, RuleRegistry, SyncDirRule } from "../rule-registry.js";
import { anyExists, topLevelEmitted } from "./synced-output.js";

/** Warns once per root dir whose top-level entries have no emitted counterpart under `syncDir`. */
export const nothingEmitted: SyncDirRule = {
	id: "nothing-emitted",
	order: 10,
	check: async ({ config, layout }, fileSystem) => {
		if (!isSynced(layout)) return [];
		const { syncDir, projectDir, commonRoot: common } = layout;

		const shown = (target: string) =>
			relativeToProject(target, projectDir) || ".";
		const warnings = [];

		for (const rootDir of config.rootDirs) {
			const emitted = await topLevelEmitted(fileSystem, rootDir, layout);
			if (emitted.length === 0 || (await anyExists(fileSystem, emitted)))
				continue;

			const expected = path.join(syncDir, path.relative(common, rootDir));
			const found = await findShifted(fileSystem, syncDir, emitted[0]);
			const nearest = found
				? `Found "${shown(found)}" — is the compiler's output rooted differently?`
				: `The nearest path that exists is "${shown(await nearestExisting(fileSystem, expected))}" — has the compiler run?`;
			warnings.push(
				warningDiagnostic(
					"output.nothingEmitted",
					{ resource: rootDir },
					`nothing emitted for root dir "${shown(rootDir)}" exists under "${shown(expected)}". ${nearest}`
				)
			);
		}
		return warnings;
	},
};

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

Registry.as<RuleRegistry>(Extensions.Rules).registerSyncDirRule(nothingEmitted);
