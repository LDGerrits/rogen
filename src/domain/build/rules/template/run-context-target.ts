import { BuildRule } from "../../build-record.js";
import { TreeDiagnostics } from "../../tree-diagnostics.js";

const PLAYER_SCRIPT_CONTAINERS = new Set([
	"StarterPlayerScripts",
	"StarterCharacterScripts",
]);

/** Rojo can't give scripts a run context there, so they'd never run. */
export const runContextTarget: BuildRule = ({ config }) => {
	if (config.template?.project.emitLegacyScripts !== false) return [];
	const routes = Object.entries(config.routes)
		.filter(([, target]) => {
			const [service, container] = target.split("/");
			return (
				service === "StarterPlayer" &&
				PLAYER_SCRIPT_CONTAINERS.has(container)
			);
		})
		.map(([key, target]) => ({ key, target }));
	return routes.length > 0
		? [
				TreeDiagnostics.runContextTarget(
					{ resource: config.outFile },
					routes
				),
			]
		: [];
};
