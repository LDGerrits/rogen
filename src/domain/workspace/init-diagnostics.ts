import {
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";

export const InitDiagnostics = {
	tooManyNames: (location: DiagnosticLocation) =>
		errorDiagnostic(
			"init.tooManyNames",
			location,
			"init takes at most one config name."
		),
	invalidName: (location: DiagnosticLocation, name: string) =>
		errorDiagnostic(
			"init.invalidName",
			location,
			`"${name}" is not a valid config name: it can't contain path separators.`
		),
};
