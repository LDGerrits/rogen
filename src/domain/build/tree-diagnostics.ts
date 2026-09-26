import {
	Diagnostic,
	DiagnosticLocation,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";

export interface RunContextRoute {
	readonly key: string;
	readonly target: string;
}

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

	runContextTarget: (
		location: DiagnosticLocation,
		routes: readonly RunContextRoute[]
	): Diagnostic =>
		warningDiagnostic(
			"tree.runContextTarget",
			location,
			`emitLegacyScripts: false in the template isn't supported with routes that target StarterPlayerScripts or StarterCharacterScripts (${routes.map(({ key, target }) => `"${key}" → ${target}`).join(", ")}). Route ${routes.length === 1 ? "it" : "them"} to another service, or remove emitLegacyScripts from the template.`
		),
};
