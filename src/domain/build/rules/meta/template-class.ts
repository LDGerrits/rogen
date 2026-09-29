import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { instanceKey } from "../../../rojo/rojo-tree.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

export const templateClass: BuildRule = {
	id: "template-class",
	order: 130,
	check: ({ config, metaOutcomes }) =>
		metaOutcomes.flatMap((outcome) => {
			if (outcome.kind !== "copied") return [];
			const { instancePath, meta, templateNode } = outcome;
			if (
				templateNode.$className === undefined ||
				meta.className === undefined ||
				templateNode.$className === meta.className
			)
				return [];
			return [
				warningDiagnostic(
					"meta.templateClass",
					{ resource: config.outFile },
					`the template makes "${instanceKey(instancePath)}" a ${templateNode.$className}, but ${meta.file} makes it a ${meta.className}, so the template's class is kept.`
				),
			];
		}),
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(templateClass);
