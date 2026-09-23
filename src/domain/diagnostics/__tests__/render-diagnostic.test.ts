import { createDiagnostic } from "../diagnostic-codes.js";
import { renderDiagnostic } from "../render-diagnostic.js";

describe("domain/diagnostics/render-diagnostic", () => {
	describe("renderDiagnostic", () => {
		it("should render location, severity, code and message", () => {
			const diagnostic = createDiagnostic(
				"RG1004",
				{ file: "lobby.rogen.json", line: 7, column: 3 },
				"outDir",
				"syncDir"
			);

			expect(renderDiagnostic(diagnostic)).toBe(
				'lobby.rogen.json:7:3 - error RG1004: unknown field "outDir". Did you mean "syncDir"?'
			);
		});

		it("should render an unknown field without a suggestion", () => {
			const diagnostic = createDiagnostic(
				"RG1004",
				{ file: "a.rogen.json", line: 1, column: 1 },
				"bogus"
			);

			expect(renderDiagnostic(diagnostic)).toBe(
				'a.rogen.json:1:1 - error RG1004: unknown field "bogus".'
			);
		});
	});
});
