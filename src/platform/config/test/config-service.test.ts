import { jest } from "@jest/globals";
import { ok } from "../../../base/result.js";
import { ConfigNormalizer } from "../normalizer.js";
import { IConfigProvider } from "../providers/provider.js";
import { ConfigService } from "../config-service.js";
import { ConfigValidator } from "../validator.js";

describe("ConfigService", () => {
	it("should merge providers in the order they are added", async () => {
		const mockNormalizer = {
			normalize: jest.fn().mockImplementation((config) => ok(config)),
		} as unknown as ConfigNormalizer;

		const mockValidator = {
			validate: jest.fn().mockImplementation((config) => ok(config)),
		} as unknown as ConfigValidator;

		const provider1: IConfigProvider = {
			name: "Provider1",
			read: async () => ok({ source: ["src1"], casing: "pascal" }),
		};

		const provider2: IConfigProvider = {
			name: "Provider2",
			read: async () => ok({ source: ["src2"], verbatim: true }),
		};

		const service = new ConfigService(mockNormalizer, mockValidator)
			.addProvider(provider1)
			.addProvider(provider2);

		const result = await service.load({ cwd: "/mock" });

		expect(result.isOk()).toBe(true);

		const finalConfig = result.unwrap();
		expect(finalConfig.source).toEqual(["src2"]);
		expect(finalConfig.casing).toBe("pascal");
		expect(finalConfig.verbatim).toBe(true);
	});
});
