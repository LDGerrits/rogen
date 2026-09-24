import { errorDiagnostic } from "../diagnostic.js";
import { DiagnosticsError } from "../diagnostics-error.js";

describe("platform/diagnostics/diagnostics-error", () => {
	describe("DiagnosticsError", () => {
		const diagnostics = [
			errorDiagnostic(
				"test.first",
				{ resource: "/repo/a.json", position: { line: 2, column: 5 } },
				"first."
			),
			errorDiagnostic("test.second", { resource: "/repo" }, "second."),
		];

		it("should render one diagnostic per line as its message", () => {
			expect(new DiagnosticsError(diagnostics).message).toBe(
				"/repo/a.json:2:5 - error: first.\n/repo - error: second."
			);
		});

		it("should keep the diagnostics it was made from", () => {
			expect(new DiagnosticsError(diagnostics).diagnostics).toBe(
				diagnostics
			);
		});

		it("should be an Error", () => {
			expect(new DiagnosticsError(diagnostics)).toBeInstanceOf(Error);
		});
	});
});
