import { Diagnostic } from "./diagnostic.js";
import { renderDiagnostics } from "./render-diagnostic.js";

/** An `Error` whose message is the rendered diagnostics, for callers that only print it. */
export class DiagnosticsError extends Error {
	constructor(readonly diagnostics: readonly Diagnostic[]) {
		super(renderDiagnostics(diagnostics));
		this.name = "DiagnosticsError";
	}
}
