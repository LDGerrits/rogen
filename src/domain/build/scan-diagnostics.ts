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
	unresolvedLink: (link: string): Diagnostic =>
		warningDiagnostic(
			"scan.unresolvedLink",
			{ resource: link },
			"this link points at nothing, or back at a directory that contains it, so it contributes nothing."
		),
};
