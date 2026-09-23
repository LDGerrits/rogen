import { Diagnostics } from "../diagnostic.js";
import { renderDiagnostic } from "../render-diagnostic.js";

describe("domain/diagnostics/render-diagnostic", () => {
	describe("renderDiagnostic", () => {
		it("should render location, severity and message", () => {
			const diagnostic = Diagnostics.unknownField(
				{ file: "lobby.rogen.json", line: 7, column: 3 },
				"outDir"
			);

			expect(renderDiagnostic(diagnostic)).toBe(
				'lobby.rogen.json:7:3 - error: unknown field "outDir".'
			);
		});

		it("should render a syntax error with its detail", () => {
			const diagnostic = Diagnostics.invalidSyntax(
				{ file: "a.rogen.json", line: 3, column: 2 },
				"expected ','"
			);

			expect(renderDiagnostic(diagnostic)).toBe(
				"a.rogen.json:3:2 - error: invalid JSONC: expected ','."
			);
		});
	});
});
