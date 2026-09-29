import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { withFirstLetterFlipped } from "./keys/declared-key.js";

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
			`differs from the ${kind} "${key}" only in letter case, so it is read as an ordinary name. Spell it "${key}" or "${withFirstLetterFlipped(key)}", or declare it as written.`
		),

	unrouted: (location: DiagnosticLocation): Diagnostic =>
		warningDiagnostic(
			"route.unrouted",
			location,
			'matched no route, so it is left out. Add a "*" route, or move it into a routing folder.'
		),

	capitalSuffix: (
		location: DiagnosticLocation,
		key: string,
		instancePath: string,
		separatorName: string,
		example: string | undefined
	): Diagnostic =>
		warningDiagnostic(
			"route.capitalSuffix",
			location,
			`routed to "${key}" by its capital suffix, so it becomes ${instancePath}. To route it on purpose, name it ${separatorName}; to keep its name, put it under ${example ? `${example}/ or mark its folder .${example}` : "another routing folder"}.`
		),
};
