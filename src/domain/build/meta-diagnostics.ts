import {
	Diagnostic,
	DiagnosticLocation,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { listPaths } from "./path-list.js";

export const MetaDiagnostics = {
	unclaimed: (
		location: DiagnosticLocation,
		entries: readonly string[]
	): Diagnostic =>
		warningDiagnostic(
			"meta.unclaimed",
			location,
			`${entries.length} meta ${entries.length === 1 ? "file belongs" : "files belong"} to no file, so Rojo ignores ${entries.length === 1 ? "it" : "them"} (${listPaths(entries)}). A file's meta is named after the name Rojo gives the file, without .server, .client or .plugin.`
		),
};
