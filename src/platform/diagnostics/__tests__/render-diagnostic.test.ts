import { Diagnostic, DiagnosticSeverity } from "../diagnostic.js";
import { renderDiagnostic } from "../render-diagnostic.js";

describe("platform/diagnostics/render-diagnostic", () => {
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
	});
});
