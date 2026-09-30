import {
	Diagnostic,
	DiagnosticJson,
	diagnosticToJson,
	renderDiagnostic,
	renderDiagnostics,
} from "./diagnostic.js";

/** An `Error` whose message is the rendered diagnostics, for callers that only print it. Identical diagnostics are kept once. */
export class DiagnosticsError extends Error {
	readonly diagnostics: readonly Diagnostic[];

	constructor(diagnostics: readonly Diagnostic[]) {
		const unique = [
			...new Map(
				diagnostics.map((diagnostic) => [
					renderDiagnostic(diagnostic),
					diagnostic,
				])
			).values(),
		];
		super(renderDiagnostics(unique));
		this.name = "DiagnosticsError";
		this.diagnostics = unique;
	}
}

/** What a `--json` run prints when it fails before it has anything else to show. */
export function failureToJson(
	error: Error
):
	| { readonly diagnostics: readonly DiagnosticJson[] }
	| { readonly error: string } {
	return error instanceof DiagnosticsError
		? { diagnostics: error.diagnostics.map(diagnosticToJson) }
		: { error: error.message };
}
