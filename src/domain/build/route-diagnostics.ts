import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { listPaths } from "./path-list.js";

export const RouteDiagnostics = {
	noRoutes: (location: DiagnosticLocation): Diagnostic =>
		errorDiagnostic(
			"route.noRoutes",
			location,
			'no routes declared, so nothing can be placed.\nAdd a "routes" map — `rogen init` writes a starting set.'
		),

	unrouted: (
		location: DiagnosticLocation,
		paths: readonly string[]
	): Diagnostic =>
		warningDiagnostic(
			"route.unrouted",
			location,
			`${paths.length} ${paths.length === 1 ? "file" : "files"} matched no route and ${paths.length === 1 ? "was" : "were"} left out (${listPaths(paths)}). Add a "*" route to place them.`
		),
};
