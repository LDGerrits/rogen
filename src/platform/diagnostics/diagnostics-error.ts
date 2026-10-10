import {
	Diagnostic,
	renderDiagnostics,
	uniqueDiagnostics,
} from "./diagnostic.js";

/** An `Error` whose message is the rendered diagnostics, for callers that only print it. Identical diagnostics are kept once. */
export class DiagnosticsError extends Error {
	override readonly name = "DiagnosticsError";
	readonly diagnostics: readonly Diagnostic[];

	constructor(diagnostics: readonly Diagnostic[]) {
		const unique = uniqueDiagnostics(diagnostics);
		super(renderDiagnostics(unique));
		this.diagnostics = unique;
	}

	/** The error for `diagnostics`; none when there are none. */
	static of(
		diagnostics: readonly Diagnostic[]
	): DiagnosticsError | undefined {
		return diagnostics.length > 0
			? new DiagnosticsError(diagnostics)
			: undefined;
	}
}
