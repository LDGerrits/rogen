import { ErrorKind, KindedError } from "../../base/errors.js";
import {
	Diagnostic,
	renderDiagnostics,
	uniqueDiagnostics,
} from "./diagnostic.js";

/** An `Error` whose message is the rendered diagnostics, for callers that only print it. Identical diagnostics are kept once. */
export class DiagnosticsError extends KindedError {
	override readonly name = "DiagnosticsError";
	readonly diagnostics: readonly Diagnostic[];

	/** `kind` is `project` unless the diagnostics are about the command line, as a Rojo that refused its arguments. */
	constructor(
		diagnostics: readonly Diagnostic[],
		readonly kind: ErrorKind = "project"
	) {
		const unique = uniqueDiagnostics(diagnostics);
		super(renderDiagnostics(unique));
		this.diagnostics = unique;
	}

	static of(
		diagnostics: readonly Diagnostic[]
	): DiagnosticsError | undefined {
		return diagnostics.length > 0
			? new DiagnosticsError(diagnostics)
			: undefined;
	}
}
