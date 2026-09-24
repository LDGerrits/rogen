import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../platform/diagnostics/diagnostic.js";

export const ScanDiagnostics = {
	missingRootDir: (rootDir: string): Diagnostic => ({
		severity: DiagnosticSeverity.Warning,
		code: "scan.missingRootDir",
		message: "this root dir does not exist, so it contributes nothing.",
		resource: rootDir,
	}),
};
