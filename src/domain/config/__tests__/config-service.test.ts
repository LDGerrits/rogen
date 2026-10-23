import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { UsageError } from "../../../base/errors.js";
import { validFile, singleProjectError } from "../config-service.js";
import { brokenEntry, mockEntry } from "./mock-config-service.js";

describe("domain/config/config-service", () => {
	describe("singleProjectError", () => {
		it("should be nothing for none or one project", () => {
			expect(singleProjectError("build", [])).toBeUndefined();
			expect(
				singleProjectError("build", ["places/lobby"])
			).toBeUndefined();
		});

		it("should name the second project and the usage", () => {
			const error = singleProjectError("serve", ["a", "b", "c"]);

			expect(error).toBeInstanceOf(UsageError);
			expect(error?.reason).toBe(
				"unexpected argument 'b' found: serve takes one [PROJECT]."
			);
			expect(error?.hint).toBe("Usage: rogen serve [OPTIONS] [PROJECT]");
		});
	});

	describe("validFile", () => {
		const error = errorDiagnostic("x.err", { resource: "/a" }, "bad.");

		it("should be the config of a valid entry", () => {
			const entry = mockEntry();

			expect(validFile(entry)?.config).toBe(entry.config);
		});

		it("should be the last valid version of a broken entry", () => {
			const entry = brokenEntry([error], undefined, {
				sourcePaths: ["/repo/a"],
			});

			expect(validFile(entry)?.config.sourcePaths).toEqual(["/repo/a"]);
		});

		it("should be undefined for a config that was never valid", () => {
			expect(validFile(brokenEntry([error]))).toBeUndefined();
		});
	});
});
