export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
	readonly code: string;
	readonly severity: DiagnosticSeverity;
	readonly message: string;
	readonly file: string;
	readonly line: number;
	readonly column: number;
}
