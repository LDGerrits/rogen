import { Diagnostic, DiagnosticSeverity } from "./diagnostic.js";

interface DiagnosticTemplate {
	readonly severity: DiagnosticSeverity;
	readonly message: (...args: never[]) => string;
}

export const DiagnosticCodes = {
	RG1001: {
		severity: "error",
		message: (detail: string) => `invalid JSONC: ${detail}.`,
	},
	RG1002: {
		severity: "error",
		message: () => "a config must be a JSON object.",
	},
	RG1004: {
		severity: "error",
		message: (name: string, suggestion?: string) =>
			`unknown field "${name}".` +
			(suggestion ? ` Did you mean "${suggestion}"?` : ""),
	},
} satisfies Record<string, DiagnosticTemplate>;

export type DiagnosticCode = keyof typeof DiagnosticCodes;

export interface DiagnosticLocation {
	readonly file: string;
	readonly line: number;
	readonly column: number;
}

export function createDiagnostic<C extends DiagnosticCode>(
	code: C,
	location: DiagnosticLocation,
	...args: Parameters<(typeof DiagnosticCodes)[C]["message"]>
): Diagnostic {
	const template = DiagnosticCodes[code];
	const message = (template.message as (...a: unknown[]) => string)(...args);
	return { code, severity: template.severity, message, ...location };
}
