import { relativeTo } from "../../base/path.js";

export enum DiagnosticSeverity {
	Error,
	Warning,
}

export interface DiagnosticPosition {
	readonly line: number;
	readonly column: number;
}

/** `position` is optional: a diagnostic about a whole file or directory has no line to point at. */
export interface DiagnosticLocation {
	/** An absolute path: a file, a directory or a config. */
	readonly resource: string;
	readonly position?: DiagnosticPosition;
}

export interface Diagnostic extends DiagnosticLocation {
	readonly severity: DiagnosticSeverity;
	/** Stable identifier such as `config.unknownField`; tests assert on it. */
	readonly code: string;
	readonly message: string;
}

export const isError = (diagnostic: Diagnostic): boolean =>
	diagnostic.severity === DiagnosticSeverity.Error;

export function errorDiagnostic(
	code: string,
	location: DiagnosticLocation,
	message: string
): Diagnostic {
	return {
		...location,
		severity: DiagnosticSeverity.Error,
		code,
		message,
	};
}

export function warningDiagnostic(
	code: string,
	location: DiagnosticLocation,
	message: string
): Diagnostic {
	return {
		...location,
		severity: DiagnosticSeverity.Warning,
		code,
		message,
	};
}

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
			: relativeTo(cwd, diagnostic.resource);
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
