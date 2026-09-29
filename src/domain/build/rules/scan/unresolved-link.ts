import { compareStrings } from "../../../../base/collection.js";
import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

export const unresolvedLink: BuildRule = {
	id: "unresolved-link",
	order: 20,
	check: ({ leftOut }) =>
		[...leftOut]
			.filter(([, why]) => why.status === "skipped")
			.map(([link]) => link)
			.sort(compareStrings)
			.map((link) =>
				warningDiagnostic(
					"scan.unresolvedLink",
					{ resource: link },
					"this link points at nothing, or back at a directory that contains it, so it contributes nothing."
				)
			),
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(unresolvedLink);
