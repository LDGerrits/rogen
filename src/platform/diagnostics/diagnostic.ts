import path from "path";
import {
	containsPath,
	relativeTo,
	toNative,
	toPosix,
} from "../../base/path.js";
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

export interface RenameFix {
	readonly rename: { readonly from: string; readonly to: string };
}

export interface RunFix {
	readonly run: { readonly command: string; readonly cwd: string };
}

/** What resolves a diagnostic: renaming a file or folder, or running a command in a directory. Paths are absolute. */
export type DiagnosticFix = RenameFix | RunFix;

export const isRenameFix = (fix: DiagnosticFix): fix is RenameFix =>
	"rename" in fix;

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

/** `message` with the paths under `cwd` written relative to it. */
export function messageRelativeTo(message: string, cwd: string): string {
	return stripDirectory(message, cwd);
}

/** `message` ending in `(code)`: on its first line, since a grouped diagnostic lists its related entries on the lines after it. */
function messageWithCode(message: string, code: string): string {
	const end = message.indexOf("\n");
	return end === -1
		? `${message} (${code})`
		: `${message.slice(0, end)} (${code})${message.slice(end)}`;
}

/** `error: message (code)`, with any path in the message written relative to `cwd`. */
export function diagnosticSummary(
	diagnostic: Diagnostic,
	cwd?: string
): string {
	const message = messageWithCode(
		cwd === undefined
			? diagnostic.message
			: stripDirectory(diagnostic.message, cwd),
		diagnostic.code
	);
	return `${SEVERITY_LABELS[diagnostic.severity]}: ${message}`;
}

/** With `cwd`, the resource and any path in the message are written relative to it. */
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
	readonly related?: readonly {
		readonly file: string;
		readonly message: string;
	}[];
	/** As the diagnostic's, with native paths. */
	readonly fixes?: readonly DiagnosticFix[];
}

/** The anchor of `code`'s section on the diagnostics page: `route.dotRoute` is `route-dotroute`. */
const diagnosticAnchor = (code: string): string =>
	code.replace(".", "-").toLowerCase();

/** The form a `--json` run prints. */
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
		...(fixes && { fixes: fixes.map(fixToJson) }),
	};
}

/** A fix with native paths, as a `--json` run prints it. */
export function fixToJson(fix: DiagnosticFix): DiagnosticFix {
	if (isRenameFix(fix)) {
		return {
			rename: {
				from: toNative(fix.rename.from),
				to: toNative(fix.rename.to),
			},
		};
	}
	fix satisfies RunFix;
	return {
		run: {
			command: fix.run.command,
			cwd: toNative(fix.run.cwd),
		},
	};
}

export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
	return diagnostics
		.map((diagnostic) => renderDiagnostic(diagnostic))
		.join("\n");
}

/** What makes two diagnostics one as the user reads them; with `anywhere`, a diagnostic about a file is the same wherever the file is. */
export function diagnosticKey(
	diagnostic: Diagnostic,
	anywhere?: string
): string {
	return renderDiagnostic(
		diagnostic.resource === anywhere
			? { ...diagnostic, resource: "" }
			: diagnostic
	);
}

/** `diagnostics` once each, in order. */
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

/** The diagnostics of `after` that `before` didn't hold, compared as the user reads them. */
export function newDiagnostics(
	before: readonly Diagnostic[],
	after: readonly Diagnostic[]
): Diagnostic[] {
	const seen = new Set(before.map((diagnostic) => diagnosticKey(diagnostic)));
	return after.filter((diagnostic) => !seen.has(diagnosticKey(diagnostic)));
}

/** The document a `--json` run prints for `diagnostics`. */
export function diagnosticsJson(diagnostics: readonly Diagnostic[]): {
	readonly diagnostics: DiagnosticJson[];
} {
	return { diagnostics: diagnostics.map(diagnosticToJson) };
}

/** `diagnostic` as it reads about one related file: that file's message, and only the fixes that rename it. */
function narrowedTo(
	diagnostic: Omit<Diagnostic, "related">,
	{ resource, message }: DiagnosticRelated
): Diagnostic {
	return {
		...diagnostic,
		resource,
		position: undefined,
		message,
		fixes: diagnostic.fixes?.filter(
			(fix) =>
				isRenameFix(fix) &&
				toPosix(fix.rename.from) === toPosix(resource)
		),
	};
}

/** The diagnostics about `source`, each narrowed to it: a grouped one becomes the entry of its `related` that names `source`, with only the fixes that rename it. */
export function diagnosticsAbout(
	diagnostics: readonly Diagnostic[],
	source: string
): Diagnostic[] {
	const target = toPosix(source);
	return diagnostics.flatMap((diagnostic): Diagnostic[] => {
		const { related, ...rest } = diagnostic;
		const entries = (related ?? []).filter(
			({ resource }) => toPosix(resource) === target
		);
		if (entries.length > 0)
			return entries.map((entry) =>
				narrowedTo(rest, { ...entry, resource: source })
			);
		// A group is about its related files; its own resource is the config.
		return !related?.length && toPosix(diagnostic.resource) === target
			? [rest]
			: [];
	});
}

/** The diagnostics about `target`, inside it, or about a folder it lies in; a grouped one is cut to the entries that do. */
export function diagnosticsReaching(
	diagnostics: readonly Diagnostic[],
	target: string
): Diagnostic[] {
	const posixTarget = toPosix(target);
	const reaches = (resource: string) => {
		const posix = toPosix(resource);
		return (
			containsPath(posixTarget, posix) || containsPath(posix, posixTarget)
		);
	};
	return diagnostics.flatMap((diagnostic): Diagnostic[] => {
		const { related, ...rest } = diagnostic;
		if (related?.length)
			return related
				.filter(({ resource }) => reaches(resource))
				.map((entry) => narrowedTo(rest, entry));
		return reaches(diagnostic.resource) ? [rest] : [];
	});
}

/** Every diagnostic once per file it is about: a grouped one becomes an entry per related file, and any other stays as it is. */
export function diagnosticsPerFile(
	diagnostics: readonly Diagnostic[]
): Diagnostic[] {
	return diagnostics.flatMap((diagnostic): Diagnostic[] => {
		const { related, ...rest } = diagnostic;
		return related?.length
			? related.map((entry) => narrowedTo(rest, entry))
			: [rest];
	});
}
