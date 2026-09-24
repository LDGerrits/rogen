import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	warningDiagnostic,
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

	nothingEmitted: (
		location: DiagnosticLocation,
		rootDir: string,
		expected: string,
		nearest: { readonly found: boolean; readonly path: string }
	): Diagnostic =>
		warningDiagnostic(
			"output.nothingEmitted",
			location,
			`nothing emitted for root dir "${rootDir}" exists under "${expected}". ` +
				(nearest.found
					? `Found "${nearest.path}" — is the compiler's output rooted differently?`
					: `The nearest path that exists is "${nearest.path}" — has the compiler run?`)
		),
};
