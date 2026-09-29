import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { listPaths } from "../path-list.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";
import { findUnclaimedMeta } from "../find-unclaimed-meta.js";

export const unclaimedMeta: BuildRule = {
	id: "unclaimed-meta",
	order: 30,
	check: ({ config, index, roots }) => {
		const unclaimed = findUnclaimedMeta(index, roots).map(
			({ path, hint }) => (hint ? `${path} (${hint})` : path)
		);
		if (unclaimed.length === 0) return [];
		const one = unclaimed.length === 1;
		return [
			warningDiagnostic(
				"meta.unclaimed",
				{ resource: config.outFile },
				`${unclaimed.length} meta ${one ? "file belongs" : "files belong"} to no file, so Rojo ignores ${one ? "it" : "them"} (${listPaths(unclaimed)}). A file's meta is named after the name Rojo gives the file, without .server, .client or .plugin.`
			),
		];
	},
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(unclaimedMeta);
