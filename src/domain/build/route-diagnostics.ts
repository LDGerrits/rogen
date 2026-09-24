import {
	Diagnostic,
	DiagnosticLocation,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";

export const RouteDiagnostics = {
	unrouted: (
		location: DiagnosticLocation,
		count: number,
		examples: readonly string[]
	): Diagnostic =>
		warningDiagnostic(
			"route.unrouted",
			location,
			`${count} ${count === 1 ? "file" : "files"} matched no route and ${count === 1 ? "was" : "were"} left out (${examples.join(", ")}${count > examples.length ? ", …" : ""}). Add a "*" route to place them.`
		),
};
