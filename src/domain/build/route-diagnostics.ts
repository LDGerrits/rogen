import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";

export const RouteDiagnostics = {
	noRoutes: (location: DiagnosticLocation): Diagnostic =>
		errorDiagnostic(
			"route.noRoutes",
			location,
			'no routes declared, so nothing can be placed.\nAdd a "routes" map — `rogen init` writes a starting set.'
		),

	caseMismatch: (
		location: DiagnosticLocation,
		kind: "route" | "tag",
		key: string
	): Diagnostic =>
		warningDiagnostic(
			"route.caseMismatch",
			location,
			`differs from the ${kind} "${key}" only in letter case, so it is read as an ordinary name. Match the key's spelling, or declare the name as written.`
		),

	moreCaseMismatches: (
		location: DiagnosticLocation,
		count: number
	): Diagnostic =>
		warningDiagnostic(
			"route.caseMismatch",
			location,
			`${count} more ${count === 1 ? "name differs" : "names differ"} from a declared route or tag only in letter case.`
		),

	unrouted: (location: DiagnosticLocation): Diagnostic =>
		warningDiagnostic(
			"route.unrouted",
			location,
			'matched no route, so it is left out. Add a "*" route, or move it into a routing folder.'
		),

	moreUnrouted: (location: DiagnosticLocation, count: number): Diagnostic =>
		warningDiagnostic(
			"route.unrouted",
			location,
			`${count} more ${count === 1 ? "file" : "files"} matched no route and ${count === 1 ? "was" : "were"} left out.`
		),
};
