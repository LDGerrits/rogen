import { Registry } from "../../../platform/registry/registry.js";
import {
	Extensions,
	Language,
	LanguageRegistry,
	SyncTool,
	SyncToolRegistry,
} from "../toolchain.js";
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

	it("should see a language contributed after it was created", () => {
		const registration = registry().registerLanguage(fake("late", 5));

		expect(toolchain.getLanguage("late").id).toBe("late");
		expect(toolchain.getLanguages().map(({ id }) => id)).toEqual([
			"luau",
			"roblox-ts",
			"late",
		]);
		registration[Symbol.dispose]();
	});
});

describe("route keys", () => {
	const toolchain = createToolchainService();

	it("should capitalize Luau route keys and keep roblox-ts keys as written", () => {
		expect(toolchain.getLanguage("luau").routeKey("serverStorage")).toBe(
			"ServerStorage"
		);
		expect(
			toolchain.getLanguage("roblox-ts").routeKey("serverStorage")
		).toBe("serverStorage");
	});
});

describe("SyncToolRegistry", () => {
	const tools = () => Registry.as<SyncToolRegistry>(Extensions.SyncTools);
	const ids = () =>
		tools()
			.getSyncTools()
			.map(({ id }) => id)
			.sort();

	it("should hold what roblox-ts and Darklua contribute", () => {
		expect(ids()).toEqual(["darklua", "roblox-ts"]);
	});

	it("should add a contributed processor and remove it on dispose", () => {
		const registration = tools().registerSyncTool({
			id: "extra",
		});

		expect(ids()).toEqual(["darklua", "extra", "roblox-ts"]);
		registration[Symbol.dispose]();
		expect(ids()).toEqual(["darklua", "roblox-ts"]);
	});

	it("should refuse a second processor with the same id", () => {
		expect(() => tools().registerSyncTool({ id: "darklua" })).toThrow(
			'Sync tool "darklua" is already registered.'
		);
	});

	describe("roblox-ts", () => {
		const robloxTs = (): SyncTool =>
			tools()
				.getSyncTools()
				.find(({ id }) => id === "roblox-ts") as SyncTool;

		it.each(["Foo.ts", "Foo.server.tsx", "src/Foo.TS"])(
			"should write %s as Luau",
			(file) => {
				expect(robloxTs().emittedPath?.(file)).toMatch(/\.luau$/);
			}
		);

		it("should leave a Luau file's path alone", () => {
			expect(robloxTs().emittedPath?.("src/Foo.luau")).toBe(
				"src/Foo.luau"
			);
		});

		it("should only read declaration files", () => {
			expect(robloxTs().readsOnly?.("types/Foo.d.ts")).toBe(true);
			expect(robloxTs().readsOnly?.("Foo.ts")).toBe(false);
		});
	});

	describe("darklua", () => {
		it("should say it turns .meta.json into .meta.lua", () => {
			const darklua = tools()
				.getSyncTools()
				.find(({ id }) => id === "darklua");

			expect(darklua?.metaReplacement).toEqual({
				suffix: ".meta.lua",
				note: "Darklua converts every .meta.json this way.",
			});
		});
	});
});

describe("CoreToolchainService sync tools", () => {
	it("should list what is registered", () => {
		expect(
			createToolchainService()
				.getSyncTools()
				.map(({ id }) => id)
				.sort()
		).toEqual(["darklua", "roblox-ts"]);
	});
});
