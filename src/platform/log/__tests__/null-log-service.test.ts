import { errorDiagnostic } from "../../diagnostics/diagnostic.js";
import { NullLogService } from "../null-log-service.js";

describe("NullLogService", () => {
	it("should accept every call without throwing", () => {
		const log = new NullLogService();
		const methods = Object.getOwnPropertyNames(NullLogService.prototype)
			.filter((name) => name !== "constructor")
			.map((name) => log[name as keyof NullLogService]);

		expect(methods.length).toBeGreaterThan(10);
		for (const method of methods) {
			expect(() =>
				(method as (...args: unknown[]) => void).call(
					log,
					"text",
					errorDiagnostic(
						"config.invalidSyntax",
						{ resource: "/repo/a.json" },
						"boom."
					)
				)
			).not.toThrow();
		}
	});
});
