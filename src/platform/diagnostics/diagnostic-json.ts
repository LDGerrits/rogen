import {
	ErrorKind,
	ErrorKinds,
	KindedError,
	errorKind,
} from "../../base/errors.js";
import { toNative } from "../../base/path.js";
import { OutputShape } from "../output/output-shape.js";
import { DOCS_URL, REPOSITORY } from "../product/product-service.js";
import {
	Diagnostic,
	DiagnosticFix,
	SEVERITY_LABELS,
	RunFix,
	isRenameFix,
} from "./diagnostic.js";
import { DiagnosticsError } from "./diagnostics-error.js";

export interface DiagnosticJson {
	readonly file: string;
	readonly line?: number;
	readonly column?: number;
	readonly severity: "error" | "warning";
	readonly code: string;
	readonly message: string;
	readonly url: string;
	readonly related?: readonly {
		readonly file: string;
		readonly message: string;
	}[];
	readonly fixes?: readonly DiagnosticFix[];
}

export const fixShape = OutputShape.named(
	"Fix",
	OutputShape.union(
		OutputShape.object({
			rename: OutputShape.object({
				from: OutputShape.string,
				to: OutputShape.string,
			}),
		}),
		OutputShape.object({
			run: OutputShape.object({
				command: OutputShape.string,
				cwd: OutputShape.string,
			}),
		})
	)
);

export const diagnosticShape = OutputShape.named(
	"Diagnostic",
	OutputShape.object({
		file: OutputShape.string,
		line: OutputShape.optional(OutputShape.integer),
		column: OutputShape.optional(OutputShape.integer),
		severity: OutputShape.enum("error", "warning"),
		code: OutputShape.string,
		message: OutputShape.string,
		url: OutputShape.string,
		related: OutputShape.optional(
			OutputShape.array(
				OutputShape.object({
					file: OutputShape.string,
					message: OutputShape.string,
				})
			)
		),
		fixes: OutputShape.optional(OutputShape.array(fixShape)),
	})
);

const diagnosticAnchor = (code: string): string =>
	code.replace(".", "-").toLowerCase();

/** Where the docs explain `code`. */
export const diagnosticUrl = (code: string): string =>
	`${DOCS_URL}/diagnostics#${diagnosticAnchor(code)}`;

export function diagnosticToJson(diagnostic: Diagnostic): DiagnosticJson {
	const { resource, position, severity, code, message, related, fixes } =
		diagnostic;
	return {
		file: toNative(resource),
		...(position && { line: position.line, column: position.column }),
		severity: SEVERITY_LABELS[severity],
		code,
		message,
		url: diagnosticUrl(code),
		...(related && {
			related: related.map((item) => ({
				file: toNative(item.resource),
				message: item.message,
			})),
		}),
		...(fixes && { fixes: fixes.map(fixToJson) }),
	};
}

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

export function diagnosticsJson(diagnostics: readonly Diagnostic[]): {
	readonly diagnostics: DiagnosticJson[];
} {
	return { diagnostics: diagnostics.map(diagnosticToJson) };
}

export interface ErrorJson {
	readonly kind: ErrorKind;
	readonly message: string;
	readonly hint?: string;
}

/** A failure that isn't a list of diagnostics, as a program reads it; a bug says where to report it. */
export function errorToJson(error: Error): ErrorJson {
	const kind = errorKind(error);
	if (error instanceof KindedError)
		return {
			kind,
			message: error.reason,
			...(error.hint && { hint: error.hint }),
		};
	return {
		kind,
		message:
			kind === "internal"
				? `${error.message}${/[.!?]$/.test(error.message) ? "" : "."} This is a bug in Rogen: report it at https://github.com/${REPOSITORY}/issues.`
				: error.message,
	};
}

/** What a `--json` run prints when it fails before it has anything else to show. */
export function failureToJson(
	error: Error
):
	| { readonly diagnostics: readonly DiagnosticJson[] }
	| { readonly error: ErrorJson } {
	return error instanceof DiagnosticsError
		? diagnosticsJson(error.diagnostics)
		: { error: errorToJson(error) };
}

export const errorShape = OutputShape.named(
	"Error",
	OutputShape.object({
		kind: OutputShape.enum(...Object.keys(ErrorKinds)),
		message: OutputShape.string,
		hint: OutputShape.optional(OutputShape.string),
	})
);

/** What a `--json` run prints when it fails before it has anything else to show. */
export const failureShape = OutputShape.union(
	OutputShape.object({ diagnostics: OutputShape.array(diagnosticShape) }),
	OutputShape.object({ error: errorShape })
);
