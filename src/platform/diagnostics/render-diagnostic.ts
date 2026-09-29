import path from "path";
import { Diagnostic, DiagnosticSeverity } from "./diagnostic.js";

const SEVERITY_LABELS: Record<DiagnosticSeverity, string> = {
	[DiagnosticSeverity.Error]: "error",
	[DiagnosticSeverity.Warning]: "warning",
};

/** With `cwd`, the resource is written relative to it. */
export function renderDiagnostic(diagnostic: Diagnostic, cwd?: string): string {
	const { position, severity, message } = diagnostic;
	const resource =
		cwd === undefined
			? diagnostic.resource
			: path.relative(cwd, diagnostic.resource) || ".";
	const where = position
		? `${resource}:${position.line}:${position.column}`
		: resource;
	return `${where} - ${SEVERITY_LABELS[severity]}: ${message}`;
}

export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
	return diagnostics
		.map((diagnostic) => renderDiagnostic(diagnostic))
		.join("\n");
}
