import {
	Diagnostic,
	DiagnosticLocation,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { listPaths } from "./path-list.js";

export const RouteDiagnostics = {
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
