import path from "path";
import { relativeTo, toNative, toPosix } from "../../base/path.js";
import { DOCS_URL } from "../product/product-service.js";

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

/** An edit that resolves a diagnostic. Renaming a file or folder is the only kind; paths are absolute. */
export interface DiagnosticFix {
	readonly rename: { readonly from: string; readonly to: string };
}

/** A file a diagnostic is also about, and what it says about that file. */
export interface DiagnosticRelated {
	/** An absolute path. */
	readonly resource: string;
	readonly message: string;
}

export interface Diagnostic extends DiagnosticLocation {
	readonly severity: DiagnosticSeverity;
	/** Stable identifier such as `config.unknownField`; tests assert on it. */
	readonly code: string;
	/** A grouped diagnostic lists its related entries on the lines of `message` after the first, one each, in this order. */
	readonly message: string;
	/** Every file a grouped diagnostic is about, complete: a presenter caps what it prints. */
	readonly related?: readonly DiagnosticRelated[];
	/** Given only when they are the one answer; the rendered line leaves them out. */
	readonly fixes?: readonly DiagnosticFix[];
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
			? toNative(diagnostic.resource)
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
	/** The code's section on the diagnostics page. */
	readonly url: string;
	/** As the diagnostic's, with native paths. */
	readonly related?: readonly { readonly file: string; readonly message: string }[];
	/** As the diagnostic's, with native paths. */
	readonly fixes?: readonly DiagnosticFix[];
}

/** The anchor of `code`'s section on the diagnostics page: `route.dotRoute` is `route-dotroute`. */
const diagnosticAnchor = (code: string): string =>
	code.replace(".", "-").toLowerCase();

/** The form a `--json` run prints; the code is here and not in the text, since only a program matches on it. */
export function diagnosticToJson(diagnostic: Diagnostic): DiagnosticJson {
	const { resource, position, severity, code, message, related, fixes } =
		diagnostic;
	return {
		file: toNative(resource),
		...(position && { line: position.line, column: position.column }),
		severity: SEVERITY_LABELS[severity],
		code,
		message,
		url: `${DOCS_URL}/diagnostics#${diagnosticAnchor(code)}`,
		...(related && {
			related: related.map((item) => ({
				file: toNative(item.resource),
				message: item.message,
			})),
		}),
		...(fixes && {
			fixes: fixes.map(({ rename }) => ({
				rename: {
					from: toNative(rename.from),
					to: toNative(rename.to),
				},
			})),
		}),
	};
}

export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
	return diagnostics
		.map((diagnostic) => renderDiagnostic(diagnostic))
		.join("\n");
}

/** The diagnostics of `after` that `before` didn't hold, compared as the user reads them. */
export function newDiagnostics(
	before: readonly Diagnostic[],
	after: readonly Diagnostic[]
): Diagnostic[] {
	const seen = new Set(
		before.map((diagnostic) => renderDiagnostic(diagnostic))
	);
	return after.filter(
		(diagnostic) => !seen.has(renderDiagnostic(diagnostic))
	);
}
