import { ConfigService } from "../config-service.js";
import { ConfigProvider } from "../provider.js";
import { ok, err, ResultError } from "../../../base/result.js";

describe("ConfigService", () => {
	it("should merge providers sequentially into the initial config", async () => {
		const provider1: ConfigProvider = {
			name: "Provider1",
			load: async () => ok({ source: ["src1"], casing: "PascalCase" }),
		};

		const provider2: ConfigProvider = {
			name: "Provider2",
			load: async () => ok({ source: ["src2"], verbatim: true }),
		};

		const service = new ConfigService()
			.addProvider(provider1)
			.addProvider(provider2);

		const initialConfig = { defaultKey: true };
		const result = await service.resolve(initialConfig);

		expect(result.isOk()).toBe(true);
		const finalConfig = result.unwrap();

		expect(finalConfig.defaultKey).toBe(true);
		expect(finalConfig.source).toEqual(["src2"]);
		expect(finalConfig.casing).toBe("PascalCase");
		expect(finalConfig.verbatim).toBe(true);
	});

	it("should fail early if a provider returns an error", async () => {
		const failingProvider: ConfigProvider = {
			name: "FailingProvider",
			load: async () => err(new Error("Disk load failed")),
		};

		const service = new ConfigService().addProvider(failingProvider);
		const result = await service.resolve();

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"[FailingProvider] failed: Disk load failed"
		);
	});
});
