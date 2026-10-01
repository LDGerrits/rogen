import { DiagnosticSeverity } from "../diagnostic.js";
import { DiagnosticCollector } from "../diagnostic-collector.js";

const location = { resource: "/repo/a.json" };

describe("platform/diagnostics/diagnostic-collector", () => {
	describe("DiagnosticCollector", () => {
		it("should keep what it is given, in order", () => {
			const collector = new DiagnosticCollector();

			collector.error("test.first", location, "first.");
			collector.warning("test.second", location, "second.");

			expect(collector.diagnostics.map(({ code }) => code)).toEqual([
				"test.first",
				"test.second",
			]);
			expect(collector.diagnostics[1].severity).toBe(
				DiagnosticSeverity.Warning
			);
		});

		it("should only count errors as errors", () => {
			const collector = new DiagnosticCollector();
			collector.warning("test.warning", location, "warning.");

			expect(collector.hasErrors).toBe(false);

			collector.error("test.error", location, "error.");

			expect(collector.hasErrors).toBe(true);
		});

		describe("toResult", () => {
			it("should hand back the value when nothing is an error", () => {
				const collector = new DiagnosticCollector();
				collector.warning("test.warning", location, "warning.");

				expect(collector.toResult("value").unwrap()).toBe("value");
			});

			it("should fail with everything collected when one is an error", () => {
				const collector = new DiagnosticCollector();
				collector.warning("test.warning", location, "warning.");
				collector.error("test.error", location, "error.");

				const result = collector.toResult("value");

				expect(result.isErr()).toBe(true);
				expect(
					result.isErr() && result.error.map(({ code }) => code)
				).toEqual(["test.warning", "test.error"]);
			});
		});

		it("should take diagnostics another check produced", () => {
			const inner = new DiagnosticCollector();
			inner.error("test.inner", location, "inner.");
			const outer = new DiagnosticCollector();

			outer.add(inner.diagnostics);

			expect(outer.hasErrors).toBe(true);
		});
	});
});
