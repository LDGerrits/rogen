export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticLocation {
	readonly file: string;
	readonly line: number;
	readonly column: number;
}

export interface Diagnostic extends DiagnosticLocation {
	readonly code: "RG1001" | "RG1002" | "RG1004";
	readonly severity: DiagnosticSeverity;
	readonly message: string;
}

export const Diagnostics = {
	invalidSyntax: (
		location: DiagnosticLocation,
		detail: string
	): Diagnostic => ({
		...location,
		code: "RG1001",
		severity: "error",
		message: `invalid JSONC: ${detail}.`,
	}),
	notAnObject: (location: DiagnosticLocation): Diagnostic => ({
		...location,
		code: "RG1002",
		severity: "error",
		message: "a config must be a JSON object.",
	}),
	unknownField: (location: DiagnosticLocation, name: string): Diagnostic => ({
		...location,
		code: "RG1004",
		severity: "error",
		message: `unknown field "${name}".`,
	}),
};
