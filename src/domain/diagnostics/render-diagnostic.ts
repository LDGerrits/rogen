import { Diagnostic } from "./diagnostic.js";

export function renderDiagnostic(diagnostic: Diagnostic): string {
	const { file, line, column, severity, code, message } = diagnostic;
	return `${file}:${line}:${column} - ${severity} ${code}: ${message}`;
}
