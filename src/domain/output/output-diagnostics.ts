import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";

export const OutputDiagnostics = {
	writeFailed: (location: DiagnosticLocation, detail: string): Diagnostic =>
		errorDiagnostic(
			"output.writeFailed",
			location,
			`the project file could not be written: ${detail}`
		),

	sameOutFile: (
		location: DiagnosticLocation,
		configs: readonly string[]
	): Diagnostic =>
		errorDiagnostic(
			"output.sameOutFile",
			location,
			`${configs.join(" and ")} write the same file, ${location.resource}. Give each its own "outFile".`
		),
};
