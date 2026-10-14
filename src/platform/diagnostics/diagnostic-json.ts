import { toNative } from "../../base/path.js";
import { DOCS_URL } from "../product/product-service.js";
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

const diagnosticAnchor = (code: string): string =>
	code.replace(".", "-").toLowerCase();

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

/** What a `--json` run prints when it fails before it has anything else to show. */
export function failureToJson(
	error: Error
):
	| { readonly diagnostics: readonly DiagnosticJson[] }
	| { readonly error: string } {
	return error instanceof DiagnosticsError
		? diagnosticsJson(error.diagnostics)
		: { error: error.message };
}
