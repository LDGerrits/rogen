import { jest } from "@jest/globals";
import { ok, err, ResultError } from "../../../base/result.js";
import { ConfigResolver } from "../resolver.js";
import { ConfigProvider } from "../providers/provider.js";
import { ConfigService } from "../config-service.js";
import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";

describe("ConfigService", () => {
	let memFs: MemoryFileSystemService;
	let resolver: ConfigResolver;

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
		resolver = new ConfigResolver(memFs);
	});

	it("should merge providers sequentially and return the validated config", async () => {
		const provider1: ConfigProvider = {
			name: "Provider1",
			load: async () => ok({ source: ["src1"], casing: "PascalCase" }),
		};

		const provider2: ConfigProvider = {
			name: "Provider2",
			load: async () => ok({ source: ["src2"], verbatim: true }),
		};

		const service = new ConfigService(resolver)
			.addProvider(provider1)
			.addProvider(provider2);

		const result = await service.resolve();

		expect(result.isOk()).toBe(true);

		const finalConfig = result.unwrap();
		expect(finalConfig.source).toEqual(["src2"]);
		expect(finalConfig.casing).toBe("PascalCase");
		expect(finalConfig.verbatim).toBe(true);
	});

	it("should fail early if a provider returns an error", async () => {
		const spy = jest.spyOn(resolver, "resolveDependencies");

		const failingProvider: ConfigProvider = {
			name: "FailingProvider",
			load: async () => err(new Error("Disk load failed")),
		};

		const service = new ConfigService(resolver).addProvider(
			failingProvider
		);

		const result = await service.resolve();

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"[FailingProvider] failed: Disk load failed"
		);
		expect(spy).not.toHaveBeenCalled();
	});

	it("should fail if Zod schema validation fails (e.g., invalid type from provider)", async () => {
		const badProvider: ConfigProvider = {
			name: "BadProvider",
			load: async () => ok({ verbatim: "yes-please" }),
		};

		const service = new ConfigService(resolver).addProvider(badProvider);

		const result = await service.resolve();

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Configuration validation failed"
		);
	});
});
