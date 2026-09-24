import {
	Diagnostic,
	DiagnosticLocation,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";

export const TreeDiagnostics = {
	templateClash: (
		location: DiagnosticLocation,
		instance: string,
		source: string
	): Diagnostic =>
		warningDiagnostic(
			"tree.templateClash",
			location,
			`"${instance}" is defined by both the template and ${source}, so the template's is kept and ${source} is left out. Rename one of them to keep both.`
		),
};
