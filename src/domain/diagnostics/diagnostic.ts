export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticLocation {
	readonly file: string;
	readonly line: number;
	readonly column: number;
}

export interface Diagnostic extends DiagnosticLocation {
	readonly severity: DiagnosticSeverity;
	readonly message: string;
}

export const Diagnostics = {
	invalidSyntax: (
		location: DiagnosticLocation,
		detail: string
	): Diagnostic => ({
		...location,
		severity: "error",
		message: `invalid JSONC: ${detail}.`,
	}),
	notAnObject: (location: DiagnosticLocation): Diagnostic => ({
		...location,
		severity: "error",
		message: "a config must be a JSON object.",
	}),
	unknownField: (location: DiagnosticLocation, name: string): Diagnostic => ({
		...location,
		severity: "error",
		message: `unknown field "${name}".`,
	}),
	wrongType: (
		location: DiagnosticLocation,
		path: string,
		expected: string,
		found: string
	): Diagnostic => ({
		...location,
		severity: "error",
		message: `"${path}": expected ${expected}, found ${found}.`,
	}),
};
