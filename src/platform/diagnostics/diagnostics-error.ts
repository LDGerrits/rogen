import { Diagnostic } from "./diagnostic.js";
import { renderDiagnostic, renderDiagnostics } from "./render-diagnostic.js";

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
