import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { buildableConfig } from "../config-service.js";
import { brokenEntry, mockEntry } from "./mock-config-service.js";

describe("domain/config/config-service", () => {
	describe("buildableConfig", () => {
		const error = errorDiagnostic("x.err", { resource: "/a" }, "bad.");

		it("should be the config of a valid entry", () => {
			const entry = mockEntry();

			expect(buildableConfig(entry)).toBe(entry.config);
		});

		it("should be the last valid version of a broken entry", () => {
			const entry = brokenEntry([error], undefined, {
				sourcePaths: ["/repo/a"],
			});

			expect(buildableConfig(entry)?.sourcePaths).toEqual(["/repo/a"]);
		});

		it("should be undefined for a config that was never valid", () => {
			expect(buildableConfig(brokenEntry([error]))).toBeUndefined();
		});
	});
});
