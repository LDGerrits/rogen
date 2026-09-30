import path from "path";
import { relativeTo, toPosix } from "../../base/path.js";

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

const SEVERITY_LABELS: Record<DiagnosticSeverity, "error" | "warning"> = {
	[DiagnosticSeverity.Error]: "error",
	[DiagnosticSeverity.Warning]: "warning",
};

/** Drops `prefix` wherever it starts a path, not where it is the tail of a longer one. */
function stripPrefix(text: string, prefix: string): string {
	let result = "";
	let from = 0;
	for (
		let at = text.indexOf(prefix);
		at !== -1;
		at = text.indexOf(prefix, from)
	) {
		const inLongerPath = at > 0 && /[\w./\\-]/.test(text[at - 1]);
		result += text.slice(from, inLongerPath ? at + prefix.length : at);
		from = at + prefix.length;
	}
	return result + text.slice(from);
}

function stripDirectory(text: string, dir: string): string {
	const bare = dir.replace(/[\\/]+$/, "");
	if (bare === "") return text;
	return [`${bare}${path.sep}`, `${toPosix(bare)}/`].reduce(
		stripPrefix,
		text
	);
}

/** With `cwd`, the resource and any path in the message are written relative to it. */
export function renderDiagnostic(diagnostic: Diagnostic, cwd?: string): string {
	const { position, severity } = diagnostic;
	const message =
		cwd === undefined
			? diagnostic.message
			: stripDirectory(diagnostic.message, cwd);
	const resource =
		cwd === undefined
			? diagnostic.resource
			: relativeTo(cwd, diagnostic.resource);
	const where = position
		? `${resource}:${position.line}:${position.column}`
		: resource;
	return `${where} - ${SEVERITY_LABELS[severity]}: ${message}`;
}

export interface DiagnosticJson {
	readonly file: string;
	readonly line?: number;
	readonly column?: number;
	readonly severity: "error" | "warning";
	readonly code: string;
	readonly message: string;
}

/** The form a `--json` run prints; the code is here and not in the text, since only a program matches on it. */
export function diagnosticToJson(diagnostic: Diagnostic): DiagnosticJson {
	const { resource, position, severity, code, message } = diagnostic;
	return {
		file: resource,
		...(position && { line: position.line, column: position.column }),
		severity: SEVERITY_LABELS[severity],
		code,
		message,
	};
}

export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
	return diagnostics
		.map((diagnostic) => renderDiagnostic(diagnostic))
		.join("\n");
}
