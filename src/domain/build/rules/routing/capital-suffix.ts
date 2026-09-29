import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { instanceKey } from "../../../rojo/rojo-tree.js";
import { RoutedFile } from "../../build-record.js";
import { declaredKeysOf } from "../../keys/declared-key.js";
import { diagnosePaths } from "../path-list.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

/** A capital suffix routes a file whose name may only happen to end in a route key. */
export const capitalSuffix: BuildRule = {
	id: "capital-suffix",
	order: 50,
	check: ({ config, routed }) => {
		const bySource = new Map<string, RoutedFile>(
			routed
				.filter(({ separatorName }) => separatorName)
				.map((file) => [file.entry.source, file])
		);
		const shared = [...declaredKeysOf(config).routeKeys].find(
			(key) => key.toLowerCase() === "shared"
		);
		const keep = shared
			? `${shared}/ or mark its folder .${shared}`
			: "another routing folder";
		return diagnosePaths([...bySource.keys()], (resource) => {
			const file = bySource.get(resource) as RoutedFile;
			return warningDiagnostic(
				"route.capitalSuffix",
				{ resource },
				`routed to "${file.route}" by its capital suffix, so it becomes ${instanceKey(file.instancePath)}. To route it on purpose, name it ${file.separatorName}; to keep its name, put it under ${keep}.`
			);
		});
	},
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(capitalSuffix);
