import {
	Diagnostic,
	DiagnosticSeverity,
	diagnosticToJson,
	renderDiagnostic,
} from "../diagnostic.js";

describe("platform/diagnostics/diagnostic", () => {
	describe("renderDiagnostic", () => {
		it("should render resource, position, severity and message", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Error,
				code: "test.example",
				message: 'unknown field "outDir".',
				resource: "lobby.rogen.json",
				position: { line: 7, column: 3 },
			};

			expect(renderDiagnostic(diagnostic)).toBe(
				'lobby.rogen.json:7:3 - error: unknown field "outDir".'
			);
		});

		it("should leave the position out when there is none", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				code: "test.example",
				message: "it contributes nothing.",
				resource: "/repo/src",
			};

			expect(renderDiagnostic(diagnostic)).toBe(
				"/repo/src - warning: it contributes nothing."
			);
		});

		it("should render the resource relative to a working directory", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				code: "test.example",
				message: "it contributes nothing.",
				resource: "/repo/src/Net/HttpClient.luau",
			};

			expect(renderDiagnostic(diagnostic, "/repo")).toBe(
				"src/Net/HttpClient.luau - warning: it contributes nothing."
			);
			expect(
				renderDiagnostic(diagnostic, "/repo/src/Net/HttpClient.luau")
			).toBe(". - warning: it contributes nothing.");
		});
	});

	describe("diagnosticToJson", () => {
		it("should name the file, position, severity, code and message", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Error,
				code: "test.example",
				message: 'unknown field "outDir".',
				resource: "/repo/lobby.rogen.json",
				position: { line: 7, column: 3 },
			};

			expect(diagnosticToJson(diagnostic)).toEqual({
				file: "/repo/lobby.rogen.json",
				line: 7,
				column: 3,
				severity: "error",
				code: "test.example",
				message: 'unknown field "outDir".',
			});
		});

		it("should leave the position out when there is none", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				code: "test.example",
				message: "it contributes nothing.",
				resource: "/repo/src",
			};

			expect(diagnosticToJson(diagnostic)).toEqual({
				file: "/repo/src",
				severity: "warning",
				code: "test.example",
				message: "it contributes nothing.",
			});
		});
	});
});
