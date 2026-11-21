import { ErrorKind, KindedError } from "../../base/errors.js";
import {
	Diagnostic,
	renderDiagnostics,
	uniqueDiagnostics,
} from "./diagnostic.js";

export class DiagnosticsError extends KindedError {
	override readonly name = "DiagnosticsError";
	readonly diagnostics: readonly Diagnostic[];

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
