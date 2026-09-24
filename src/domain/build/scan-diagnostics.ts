import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";

export const ScanDiagnostics = {
	missingRootDir: (rootDir: string): Diagnostic =>
		warningDiagnostic(
			"scan.missingRootDir",
			{ resource: rootDir },
			"this root dir does not exist, so it contributes nothing."
		),
};
