import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

export const buriedScriptSuffix: BuildRule = {
	id: "buried-script-suffix",
	order: 80,
	check: ({ routed, leftOut }) =>
		routed.flatMap((file) =>
			file.buriedScriptSuffix &&
			leftOut.get(file.entry.source)?.status !== "pruned"
				? [
						warningDiagnostic(
							"tag.buriedScriptSuffix",
							{ resource: file.entry.source },
							`".${file.buriedScriptSuffix}" isn't this file's last suffix, so Rojo will make it a ModuleScript. Put it last, as in Foo.mock.${file.buriedScriptSuffix}.luau.`
						),
					]
				: []
		),
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(buriedScriptSuffix);
