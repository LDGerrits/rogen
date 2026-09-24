import {
	Diagnostic,
	DiagnosticLocation,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { listPaths } from "./path-list.js";

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

	standaloneData: (
		location: DiagnosticLocation,
		paths: readonly string[]
	): Diagnostic =>
		warningDiagnostic(
			"tree.standaloneData",
			location,
			`${paths.length} data ${paths.length === 1 ? "file" : "files"} can't be an instance on ${paths.length === 1 ? "its" : "their"} own and ${paths.length === 1 ? "was" : "were"} left out (${listPaths(paths)}). Wrap ${paths.length === 1 ? "it" : "them"} in a folder.`
		),
};
