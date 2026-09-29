import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

const PLAYER_SCRIPT_CONTAINERS = new Set([
	"StarterPlayerScripts",
	"StarterCharacterScripts",
]);

/** Rojo can't give scripts a run context there, so they'd never run. */
export const runContextTarget: BuildRule = {
	id: "run-context-target",
	order: 100,
	check: ({ config }) => {
		if (config.template?.project.emitLegacyScripts !== false) return [];
		const routes = Object.entries(config.routes)
			.filter(([, target]) => {
				const [service, container] = target.split("/");
				return (
					service === "StarterPlayer" &&
					PLAYER_SCRIPT_CONTAINERS.has(container)
				);
			})
			.map(([key, target]) => `"${key}" → ${target}`);
		return routes.length > 0
			? [
					warningDiagnostic(
						"tree.runContextTarget",
						{ resource: config.outFile },
						`emitLegacyScripts: false in the template isn't supported with routes that target StarterPlayerScripts or StarterCharacterScripts (${routes.join(", ")}). Route ${routes.length === 1 ? "it" : "them"} to another service, or remove emitLegacyScripts from the template.`
					),
				]
			: [];
	},
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(runContextTarget);
