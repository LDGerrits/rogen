import { Diagnostic, errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../../config/config.js";

/** One error per config that declares no routes, since nothing could be placed. */
export function findConfigsWithoutRoutes(
	configs: readonly Pick<ResolvedConfig, "file" | "routes">[]
): Diagnostic[] {
	return configs
		.filter(({ routes }) => Object.keys(routes).length === 0)
		.map(({ file }) =>
			errorDiagnostic(
				"route.noRoutes",
				{ resource: file },
				'no routes declared, so nothing can be placed.\nAdd a "routes" map — `rogen init` writes a starting set.'
			)
		);
}
