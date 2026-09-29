import { capitalized } from "../../../../base/string.js";
import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { diagnosePaths } from "../path-list.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

/** A capital suffix pruned a file whose name may only happen to end in a tag. */
export const dormantCapitalSuffix: BuildRule = {
	id: "dormant-capital-suffix",
	order: 70,
	check: ({ leftOut }) => {
		const byTag = new Map<string, Map<string, string>>();
		for (const [source, why] of leftOut) {
			if (why.status !== "pruned") continue;
			for (const { tag, separatorName } of why.tags)
				if (separatorName)
					byTag.set(
						tag,
						(byTag.get(tag) ?? new Map()).set(source, separatorName)
					);
		}
		return [...byTag].flatMap(([tag, separatorNames]) =>
			diagnosePaths([...separatorNames.keys()], (resource) =>
				warningDiagnostic(
					"tag.dormantCapitalSuffix",
					{ resource },
					`pruned because its capital suffix matches the dormant tag "${tag}". If it's a variant, name it ${separatorNames.get(resource)}; if not, rename it so it doesn't end in "${capitalized(tag)}".`
				)
			)
		);
	},
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(dormantCapitalSuffix);
