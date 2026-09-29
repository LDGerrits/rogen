import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

export const missingRootDir: BuildRule = {
	id: "missing-root-dir",
	order: 10,
	check: ({ roots }) =>
		roots
			.filter((root) => !root.exists)
			.map((root) =>
				warningDiagnostic(
					"scan.missingRootDir",
					{ resource: root.rootDir },
					"this root dir does not exist, so it contributes nothing."
				)
			),
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(missingRootDir);
