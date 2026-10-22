import path from "path";
import {
	containsPath,
	relativeTo,
	toNative,
	toPosix,
} from "../../base/path.js";

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
	readonly resource: string;
	readonly position?: DiagnosticPosition;
}

export interface RenameFix {
	readonly rename: { readonly from: string; readonly to: string };
}

export interface RunFix {
	readonly run: { readonly command: string; readonly cwd: string };
}

export interface ReplaceFix {
	readonly replace: {
		readonly file: string;
		readonly line: number;
		readonly column: number;
		readonly from: string;
		readonly to: string;
	};
}

/** What resolves a diagnostic: renaming a file or folder, replacing text in a file, or running a command in a directory. Paths are absolute. */
export type DiagnosticFix = RenameFix | ReplaceFix | RunFix;

export const isRenameFix = (fix: DiagnosticFix): fix is RenameFix =>
	"rename" in fix;

export const isReplaceFix = (fix: DiagnosticFix): fix is ReplaceFix =>
	"replace" in fix;

/** Replaces the JSON text that starts at `location` with `to`; none when the location has no position. */
export function replaceFixes(
	location: DiagnosticLocation,
	from: string,
	to: string
): ReplaceFix[] {
	const { resource, position } = location;
	return position
		? [{ replace: { file: resource, ...position, from, to } }]
		: [];
}

export interface DiagnosticRelated {
	readonly resource: string;
	readonly message: string;
}

export interface Diagnostic extends DiagnosticLocation {
	readonly severity: DiagnosticSeverity;
	/** Stable identifier such as `config.unknownField`; tests assert on it. */
	readonly code: string;
	readonly message: string;
	/** The other files the problem involves, each with its part in it. */
	readonly related?: readonly DiagnosticRelated[];
	/** Given only when they are the one answer; the rendered line leaves them out. */
	readonly fixes?: readonly DiagnosticFix[];
}

export const isError = (diagnostic: Diagnostic): boolean =>
	diagnostic.severity === DiagnosticSeverity.Error;

export function errorDiagnostic(
	code: string,
	location: DiagnosticLocation,
	message: string,
	fixes: readonly DiagnosticFix[] = []
): Diagnostic {
	return {
		...location,
		severity: DiagnosticSeverity.Error,
		code,
		message,
		...(fixes.length > 0 && { fixes }),
	};
}

export function warningDiagnostic(
	code: string,
	location: DiagnosticLocation,
	message: string,
	fixes: readonly DiagnosticFix[] = [],
	related: readonly DiagnosticRelated[] = []
): Diagnostic {
	return {
		...location,
		severity: DiagnosticSeverity.Warning,
		code,
		message,
		...(related.length > 0 && { related }),
		...(fixes.length > 0 && { fixes }),
	};
}

export const SEVERITY_LABELS: Record<DiagnosticSeverity, "error" | "warning"> =
	{
		[DiagnosticSeverity.Error]: "error",
		[DiagnosticSeverity.Warning]: "warning",
	};

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

export function messageRelativeTo(text: string, dir: string): string {
	const bare = dir.replace(/[\\/]+$/, "");
	if (bare === "") return text;
	return [`${bare}${path.sep}`, `${toPosix(bare)}/`].reduce(
		stripPrefix,
		text
	);
}

function messageWithCode(message: string, code: string): string {
	const end = message.indexOf("\n");
	return end === -1
		? `${message} (${code})`
		: `${message.slice(0, end)} (${code})${message.slice(end)}`;
}

export function diagnosticSummary(
	diagnostic: Diagnostic,
	cwd?: string
): string {
	const message = messageWithCode(
		cwd === undefined
			? diagnostic.message
			: messageRelativeTo(diagnostic.message, cwd),
		diagnostic.code
	);
	return `${SEVERITY_LABELS[diagnostic.severity]}: ${message}`;
}

export function renderDiagnostic(diagnostic: Diagnostic, cwd?: string): string {
	const { position } = diagnostic;
	const resource =
		cwd === undefined
			? toNative(diagnostic.resource)
			: relativeTo(cwd, diagnostic.resource);
	const where = position
		? `${resource}:${position.line}:${position.column}`
		: resource;
	return `${where} - ${diagnosticSummary(diagnostic, cwd)}`;
}

export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
	return diagnostics
		.map((diagnostic) => renderDiagnostic(diagnostic))
		.join("\n");
}

/** What makes two diagnostics one as the user reads them; a diagnostic about `ignoredResource` is the same wherever that file is. */
export function diagnosticKey(
	diagnostic: Diagnostic,
	ignoredResource?: string
): string {
	const { resource, position, severity, code, message } = diagnostic;
	return [
		resource === ignoredResource ? "" : toPosix(resource),
		position?.line,
		position?.column,
		severity,
		code,
		message,
	].join("\0");
}

export function uniqueDiagnostics(
	diagnostics: readonly Diagnostic[]
): Diagnostic[] {
	return [
		...new Map(
			diagnostics.map((diagnostic) => [
				diagnosticKey(diagnostic),
				diagnostic,
			])
		).values(),
	];
}

export function newDiagnostics(
	before: readonly Diagnostic[],
	after: readonly Diagnostic[]
): Diagnostic[] {
	const seen = new Set(before.map((diagnostic) => diagnosticKey(diagnostic)));
	return after.filter((diagnostic) => !seen.has(diagnosticKey(diagnostic)));
}

/** The diagnostics about `source`. */
export function diagnosticsAbout(
	diagnostics: readonly Diagnostic[],
	source: string
): Diagnostic[] {
	const target = toPosix(source);
	return diagnostics.filter(({ resource }) => toPosix(resource) === target);
}

/** The diagnostics about `target`, inside it, or about a folder it lies in. */
export function diagnosticsReaching(
	diagnostics: readonly Diagnostic[],
	target: string
): Diagnostic[] {
	const posixTarget = toPosix(target);
	return diagnostics.filter(({ resource }) => {
		const posix = toPosix(resource);
		return (
			containsPath(posixTarget, posix) || containsPath(posix, posixTarget)
		);
	});
}
