import { ErrorUtils, ProjectError, UsageError } from "../../../base/errors.js";
import { DOCS_URL } from "../../product/product-service.js";
import { errorDiagnostic } from "../diagnostic.js";
import { DiagnosticsError } from "../diagnostics-error.js";
import { failureToJson } from "../diagnostic-json.js";

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
				"/repo/a.json:2:5 - error: first. (test.first)\n/repo - error: second. (test.second)"
			);
		});

		it("should be made from diagnostics only when there are some", () => {
			expect(DiagnosticsError.of([])).toBeUndefined();
			expect(DiagnosticsError.of(diagnostics)?.diagnostics).toEqual(
				diagnostics
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
				"/repo/a.json:2:5 - error: first. (test.first)\n/repo - error: second. (test.second)"
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
						url: `${DOCS_URL}/diagnostics#test-first`,
					},
				],
			});
		});

		it("should carry the kind, message and hint of a failure that knows them", () => {
			expect(
				failureToJson(
					new UsageError('Unknown command "x".', "Run 'rogen help'.")
				)
			).toEqual({
				error: {
					kind: "usage",
					message: 'Unknown command "x".',
					hint: "Run 'rogen help'.",
				},
			});
			expect(failureToJson(new ProjectError("No rogen.json."))).toEqual({
				error: { kind: "project", message: "No rogen.json." },
			});
		});

		it("should call a failed system call an io error", () => {
			const denied = Object.assign(
				new Error("EACCES: permission denied"),
				{
					code: "EACCES",
				}
			);

			expect(failureToJson(denied)).toEqual({
				error: { kind: "io", message: "EACCES: permission denied" },
			});
			expect(
				failureToJson(ErrorUtils.wrap("Failed to write a", denied))
			).toEqual({
				error: {
					kind: "io",
					message: "Failed to write a: permission denied",
				},
			});
		});

		it("should call any other error internal, and say where to report it", () => {
			expect(failureToJson(new Error("x is undefined"))).toEqual({
				error: {
					kind: "internal",
					message:
						"x is undefined. This is a bug in Rogen: report it at https://github.com/LDGerrits/rogen/issues.",
				},
			});
		});
	});
});
