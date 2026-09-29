import { joinPosix, toPosix } from "../../../../base/path.js";
import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { FolderMeta } from "../../build-record.js";
import { listPaths } from "../path-list.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

type InstancelessFolder =
	"root dir" | "routing folder" | "tag folder" | "invisible folder";

/** Meta in folders that never become an instance, decided by the folder's name. */
export const metaAppliesToNothing: BuildRule = {
	id: "meta-applies-to-nothing",
	order: 140,
	check: ({ config, folderMeta, readings }) => {
		const instanceless = ({
			rootDir,
			dir,
		}: FolderMeta): InstancelessFolder | undefined => {
			if (dir === "") return "root dir";
			const folder = readings.folders.get(joinPosix(rootDir, dir));
			if (folder?.kind === "route") return "routing folder";
			if (folder?.kind === "tag") return "tag folder";
			return folder?.invisible ? "invisible folder" : undefined;
		};
		const metas = folderMeta.flatMap((meta) => {
			const kind = instanceless(meta);
			return kind ? [`${toPosix(meta.file)} (${kind})`] : [];
		});
		if (metas.length === 0) return [];
		const one = metas.length === 1;
		return [
			warningDiagnostic(
				"meta.appliesToNothing",
				{ resource: config.outFile },
				`${metas.length} init.meta.json ${one ? "file applies" : "files apply"} to nothing, because ${one ? "its folder never becomes" : "their folders never become"} an instance (${listPaths(metas)}). Move the meta into the folder that should get it.`
			),
		];
	},
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(metaAppliesToNothing);
