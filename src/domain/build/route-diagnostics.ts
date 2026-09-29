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

	capitalSuffix: (
		location: DiagnosticLocation,
		key: string,
		instancePath: string,
		separatorName: string
	): Diagnostic =>
		warningDiagnostic(
			"route.capitalSuffix",
			location,
			`routed to "${key}" by its capital suffix, so it becomes ${instancePath}. If that's intended, name it ${separatorName}; if not, move it into a routing folder, where the suffix is ignored.`
		),

	moreCapitalSuffixes: (
		location: DiagnosticLocation,
		count: number
	): Diagnostic =>
		warningDiagnostic(
			"route.capitalSuffix",
			location,
			`${count} more ${count === 1 ? "file was" : "files were"} routed by a capital suffix.`
		),
};
