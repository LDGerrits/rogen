import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../platform/diagnostics/diagnostic.js";

const error = (
	code: string,
	resource: string,
	message: string
): Diagnostic => ({
	severity: DiagnosticSeverity.Error,
	code,
	message,
	resource,
});

export const InitDiagnostics = {
	tooManyNames: (resource: string) =>
		error(
			"init.tooManyNames",
			resource,
			"init takes at most one config name."
		),
	invalidName: (resource: string, name: string) =>
		error(
			"init.invalidName",
			resource,
			`"${name}" is not a valid config name: it can't contain path separators.`
		),
};
