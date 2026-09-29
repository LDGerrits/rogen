import { Registry } from "../../../platform/registry/registry.js";
import { Extensions, Language, LanguageRegistry } from "../toolchain.js";
import { createToolchainService } from "./create-toolchain-service.js";

const registry = () => Registry.as<LanguageRegistry>(Extensions.Languages);

const fake = (id: string, order: number): Language => ({
	id,
	label: id,
	order,
	extension: id,
	detect: async () => ({ present: false, facts: {}, reservedFolders: [] }),
	routeKey: (key) => key,
	configuredRootDir: () => undefined,
	alwaysMounted: () => [],
	offeredMounts: () => [],
});

describe("LanguageRegistry", () => {
	it("should list the languages in their order, Luau first", () => {
		expect(
			registry()
				.getLanguages()
				.map(({ id }) => id)
		).toEqual(["luau", "roblox-ts"]);
	});

	it("should place a contributed language by its order and remove it on dispose", () => {
		const registration = registry().registerLanguage(fake("middle", 0.5));

		expect(
			registry()
				.getLanguages()
				.map(({ id }) => id)
		).toEqual(["luau", "middle", "roblox-ts"]);
		registration[Symbol.dispose]();
		expect(registry().getLanguage("middle")).toBeUndefined();
	});

	it("should refuse a second language with the same id", () => {
		expect(() => registry().registerLanguage(fake("luau", 9))).toThrow(
			'Language "luau" is already registered.'
		);
	});
});

describe("CoreToolchainService", () => {
	const toolchain = createToolchainService();

	it("should find a registered language", () => {
		expect(toolchain.getLanguage("roblox-ts").compiler?.name).toBe(
			"roblox-ts"
		);
	});

	it("should throw for a language that isn't registered", () => {
		expect(() => toolchain.getLanguage("python")).toThrow(
			'Language "python" is not registered.'
		);
	});

	it("should list the languages in their order, Luau first", () => {
		expect(toolchain.getLanguages().map(({ id }) => id)).toEqual([
			"luau",
			"roblox-ts",
		]);
	});

	it("should list a language contributed after it was created", () => {
		const registration = registry().registerLanguage(fake("late", 5));

		expect(toolchain.getLanguage("late").id).toBe("late");
		registration[Symbol.dispose]();
	});

	it("should capitalize Luau route keys and keep roblox-ts keys as written", () => {
		expect(toolchain.getLanguage("luau").routeKey("serverStorage")).toBe(
			"ServerStorage"
		);
		expect(
			toolchain.getLanguage("roblox-ts").routeKey("serverStorage")
		).toBe("serverStorage");
	});
});
