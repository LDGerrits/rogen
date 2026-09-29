import path from "path";
import { toPosix } from "../../../../base/path.js";
import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { META_FILE_SUFFIX } from "../../../rojo/rojo-files.js";
import { MetaReplacement } from "../../../toolchain/toolchain.js";
import {
	emittedPath,
	isSynced,
	relativeToProject,
} from "../../layout/sync-path.js";
import { findUnclaimedMeta } from "../find-unclaimed-meta.js";
import { listPaths } from "../path-list.js";
import { Extensions, RuleRegistry, SyncDirRule } from "../rule-registry.js";
import { hasSyncedOutput } from "./synced-output.js";

/** Warns once for claimed meta with no copy under `syncDir`, skipping root dirs `nothingEmitted` reports. */
export const metaNotSynced: SyncDirRule = {
	id: "meta-not-synced",
	order: 20,
	check: async ({ config, index, layout, roots }, fileSystem) => {
		if (!isSynced(layout)) return [];
		const { syncDir, projectDir } = layout;
		const unclaimed = new Set(
			findUnclaimedMeta(index, roots).map(({ path }) => path)
		);
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
					if (
						await fileSystem.exists(`${stem}${replacement.suffix}`)
					) {
						conversion ??= replacement;
						if (replacement === conversion) converted++;
						break;
					}
			}
		}
		if (missing.length === 0) return [];

		const them = missing.length === 1 ? "it" : "them";
		const cause = conversion
			? `The processor turned ${converted === missing.length ? them : `${converted} of them`} into ${conversion.suffix}, which Rojo syncs as a ModuleScript instead of applying. ${conversion.note}`
			: "Have the compiler copy .meta.json files into its output.";
		return [
			warningDiagnostic(
				"output.metaNotSynced",
				{ resource: config.outFile },
				`${missing.length} meta ${missing.length === 1 ? "file has" : "files have"} no copy under "${relativeToProject(syncDir, projectDir) || "."}" (${listPaths(missing)}), so Rojo doesn't apply ${them}. ${cause}`
			),
		];
	},
};

Registry.as<RuleRegistry>(Extensions.Rules).registerSyncDirRule(metaNotSynced);
