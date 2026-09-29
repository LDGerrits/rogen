import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

/** Only one untagged file can become an instance; a tagged one replacing it is the point of tags. */
export const untaggedClash: BuildRule = {
	id: "untagged-clash",
	order: 90,
	check: ({ config, clashes }) =>
		clashes
			.filter(({ claimants }) =>
				claimants.every((file) => file.tags.length === 0)
			)
			.map(({ instance, claimants }) =>
				warningDiagnostic(
					"tag.untaggedClash",
					{ resource: config.outFile },
					`${claimants.length} files all become "${instance}" (${claimants.map(({ entry }) => entry.source).join(", ")}), so only the last one is used.`
				)
			),
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(untaggedClash);
