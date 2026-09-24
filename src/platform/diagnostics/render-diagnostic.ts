import { Diagnostic, DiagnosticSeverity } from "./diagnostic.js";

const SEVERITY_LABELS: Record<DiagnosticSeverity, string> = {
	[DiagnosticSeverity.Error]: "error",
	[DiagnosticSeverity.Warning]: "warning",
};

export function renderDiagnostic(diagnostic: Diagnostic): string {
	const { resource, position, severity, message } = diagnostic;
	const where = position
		? `${resource}:${position.line}:${position.column}`
		: resource;
	return `${where} - ${SEVERITY_LABELS[severity]}: ${message}`;
}

export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
	return diagnostics.map(renderDiagnostic).join("\n");
}
