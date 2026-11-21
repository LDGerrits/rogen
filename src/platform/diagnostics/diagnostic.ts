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

export type DiagnosticFix = RenameFix | ReplaceFix | RunFix;

export const isRenameFix = (fix: DiagnosticFix): fix is RenameFix =>
	"rename" in fix;

export const isReplaceFix = (fix: DiagnosticFix): fix is ReplaceFix =>
	"replace" in fix;

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
	readonly code: string;
	readonly message: string;
	readonly details?: readonly string[];
	readonly related?: readonly DiagnosticRelated[];
	readonly fixes?: readonly DiagnosticFix[];
}

export const isError = (diagnostic: Diagnostic): boolean =>
	diagnostic.severity === DiagnosticSeverity.Error;

export function errorDiagnostic(
	code: string,
	location: DiagnosticLocation,
	message: string,
	fixes: readonly DiagnosticFix[] = [],
	related: readonly DiagnosticRelated[] = []
): Diagnostic {
	return {
		...location,
		severity: DiagnosticSeverity.Error,
		code,
		message,
		...(related.length > 0 && { related }),
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
	cwd?: string,
	severity: (label: string) => string = (label) => label
): string {
	const relative = (text: string) =>
		cwd === undefined ? text : messageRelativeTo(text, cwd);
	const message = messageWithCode(
		relative(diagnostic.message),
		diagnostic.code
	);
	const details = (diagnostic.details ?? []).map(
		(detail) => `\n  ${relative(detail)}`
	);
	return `${severity(`${SEVERITY_LABELS[diagnostic.severity]}:`)} ${message}${details.join("")}`;
}

export function renderDiagnostic(
	diagnostic: Diagnostic,
	cwd?: string,
	severity?: (label: string) => string
): string {
	const { position } = diagnostic;
	const resource =
		cwd === undefined
			? toNative(diagnostic.resource)
			: relativeTo(cwd, diagnostic.resource);
	const where = position
		? `${resource}:${position.line}:${position.column}`
		: resource;
	return `${where} - ${diagnosticSummary(diagnostic, cwd, severity)}`;
}

export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
	return diagnostics
		.map((diagnostic) => renderDiagnostic(diagnostic))
		.join("\n");
}

export function diagnosticKey(
	diagnostic: Diagnostic,
	ignoredResource?: string
): string {
	const { resource, position, severity, code, message, details } = diagnostic;
	return [
		resource === ignoredResource ? "" : toPosix(resource),
		position?.line,
		position?.column,
		severity,
		code,
		message,
		...(details ?? []),
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

function filesOf({ resource, related }: Diagnostic): string[] {
	return [resource, ...(related ?? []).map(({ resource }) => resource)].map(
		toPosix
	);
}

export function isAbout(diagnostic: Diagnostic, source: string): boolean {
	return filesOf(diagnostic).includes(toPosix(source));
}

export function reaches(
	diagnostic: Diagnostic,
	target: string,
	folder: string = diagnostic.resource
): boolean {
	return (
		isAboutAnythingIn(diagnostic, target) ||
		coversFromFolder(diagnostic, folder, target)
	);
}

function isAboutAnythingIn(diagnostic: Diagnostic, target: string): boolean {
	const posixTarget = toPosix(target);
	return filesOf(diagnostic).some((file) => containsPath(posixTarget, file));
}

function coversFromFolder(
	diagnostic: Diagnostic,
	folder: string,
	target: string
): boolean {
	return (
		!listsItsFiles(diagnostic) &&
		containsPath(toPosix(folder), toPosix(target))
	);
}

function listsItsFiles(diagnostic: Diagnostic): boolean {
	return diagnostic.related !== undefined;
}
