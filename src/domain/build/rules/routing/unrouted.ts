import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { diagnosePaths } from "../path-list.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

export const unrouted: BuildRule = {
	id: "unrouted",
	order: 60,
	check: ({ leftOut }) =>
		diagnosePaths(
			[...leftOut]
				.filter(([, why]) => why.status === "unrouted")
				.map(([source]) => source),
			(resource) =>
				warningDiagnostic(
					"route.unrouted",
					{ resource },
					'matched no route, so it is left out. Add a "*" route, or move it into a routing folder.'
				)
		),
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(unrouted);
