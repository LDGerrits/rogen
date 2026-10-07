import { errorDiagnostic } from "../diagnostic.js";
import { DiagnosticsError, failureToJson } from "../diagnostics-error.js";

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
			expect(new DiagnosticsError(diagnostics).diagnostics).toEqual(
				diagnostics
			);
		});

		it("should keep one of each identical diagnostic", () => {
			const error = new DiagnosticsError([
				...diagnostics,
				diagnostics[0],
			]);

			expect(error.diagnostics).toEqual(diagnostics);
			expect(error.message).toBe(
				"/repo/a.json:2:5 - error: first.\n/repo - error: second."
			);
		});

		it("should be an Error", () => {
			expect(new DiagnosticsError(diagnostics)).toBeInstanceOf(Error);
		});
	});

	describe("failureToJson", () => {
		it("should list the diagnostics of a DiagnosticsError", () => {
			const error = new DiagnosticsError([
				errorDiagnostic(
					"test.first",
					{
						resource: "/repo/a.json",
						position: { line: 2, column: 5 },
					},
					"first."
				),
			]);

			expect(failureToJson(error)).toEqual({
				diagnostics: [
					{
						file: "/repo/a.json",
						line: 2,
						column: 5,
						severity: "error",
						code: "test.first",
						message: "first.",
						url: "https://rogen-playfully.vercel.app/docs/v2/diagnostics#test-first",
					},
				],
			});
		});

		it("should carry the message of any other error", () => {
			expect(failureToJson(new Error("No config found."))).toEqual({
				error: "No config found.",
			});
		});
	});
});
