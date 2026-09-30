import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { Darklua } from "../../toolchain/toolchain.js";
import { ConfigSet } from "../config-set.js";

const luau = workspaceOf().languageFor("luau");
const robloxTs = workspaceOf().languageFor("roblox-ts");

describe("ConfigSet.syncStemOf", () => {
	it("should call default's synced config sync", () => {
		expect(ConfigSet.syncStemOf("default")).toBe("sync");
	});

	it("should suffix any other name", () => {
		expect(ConfigSet.syncStemOf("lobby")).toBe("lobby-sync");
	});
});

describe("ConfigSet", () => {
	describe("without a processor", () => {
		const set = new ConfigSet("default", luau, false);

		it("should write one config, and serve it", () => {
			expect(set.sourced).toBe(false);
			expect(set.syncFile).toBeUndefined();
			expect(set.configFiles).toEqual(["default.rogen.json"]);
			expect(set.servedStem).toBe("default");
			expect(set.stems).toEqual(["default"]);
		});

		it("should write one project file", () => {
			expect(set.outputFiles).toEqual(["default.project.json"]);
		});
	});

	describe("with Darklua reading the root dirs", () => {
		const set = new ConfigSet("game", luau, true);

		it("should write the named config first, then the synced one", () => {
			expect(set.sourced).toBe(true);
			expect(set.syncFile).toBe("game-sync.rogen.json");
			expect(set.configFiles).toEqual([
				"game.rogen.json",
				"game-sync.rogen.json",
			]);
		});

		it("should serve the synced project", () => {
			expect(set.servedStem).toBe("game-sync");
		});

		it("should list the source-rooted project first", () => {
			expect(set.stems).toEqual(["game", "game-sync"]);
			expect(set.outputFiles).toEqual([
				"game.project.json",
				"game-sync.project.json",
			]);
		});
	});

	describe("with a compiler", () => {
		it("should write one config even when Darklua reads the compiler's output", () => {
			const set = new ConfigSet("default", robloxTs, true);

			expect(set.sourced).toBe(false);
			expect(set.configFiles).toEqual(["default.rogen.json"]);
		});
	});

	describe("placeFiles", () => {
		it("should be the place's config and project file", () => {
			expect(new ConfigSet("lobby", luau, false).placeFiles).toEqual([
				"lobby.rogen.json",
				"lobby.project.json",
			]);
		});

		it("should add the synced config of a sourced place", () => {
			expect(new ConfigSet("lobby", luau, true).placeFiles).toEqual([
				"lobby.rogen.json",
				"lobby-sync.rogen.json",
				"lobby.project.json",
			]);
		});

		it("should add the compiler's own per-place files", () => {
			expect(new ConfigSet("lobby", robloxTs, false).placeFiles).toEqual([
				"lobby.rogen.json",
				"tsconfig.lobby.json",
				"lobby.project.json",
			]);
		});
	});
});

describe("ConfigSet naming", () => {
	it("should write a reference as a relative path", () => {
		expect(ConfigSet.reference("default.rogen.json")).toBe(
			"./default.rogen.json"
		);
	});

	it("should keep a place's code under places", () => {
		expect(ConfigSet.placeFolderOf("lobby")).toBe("places/lobby");
	});

	it("should write a variant's config and project file", () => {
		expect(ConfigSet.variantFilesOf("prod")).toEqual([
			"prod.rogen.json",
			"prod.project.json",
		]);
	});

	it("should watch default without naming it, and any other set by its stems", () => {
		expect(ConfigSet.watchCommand(["default"])).toBe("rogen watch");
		expect(ConfigSet.watchCommand(["lobby"])).toBe("rogen watch lobby");
		expect(ConfigSet.watchCommand(["lobby", "lobby-sync"])).toBe(
			"rogen watch lobby lobby-sync"
		);
	});

	it("should point at where variants of a script are swapped in", () => {
		expect(ConfigSet.tagsStep(luau, "default.rogen.json")).toBe(
			'Add tags under "tags" in default.rogen.json to swap in variants like Analytics.mock.luau.'
		);
	});

	it("should start the default config from default.rogen.json", () => {
		expect(ConfigSet.DEFAULT_FILE).toBe("default.rogen.json");
	});

	describe("parseName", () => {
		it("should be default without a name", () => {
			expect(ConfigSet.parseName([]).unwrap()).toBe("default");
		});

		it("should take the one name given", () => {
			expect(ConfigSet.parseName(["lobby"]).unwrap()).toBe("lobby");
		});

		it.each([
			[["a", "b"], "at most one"],
			[[" "], "can't be empty"],
			[["a/b"], "path separators"],
			[[".."], "path separators"],
			[["template"], "over template.project.json"],
		])("should reject %j", (names, message) => {
			const result = ConfigSet.parseName(names);

			expect(result.isErr() && result.error.message).toContain(message);
		});
	});

	describe("syncDirBy", () => {
		const darklua = new Darklua();

		it("should be Darklua's output when Darklua processes the code", () => {
			expect(new ConfigSet("game", luau, true).syncDirBy(darklua)).toBe(
				"dist"
			);
		});

		it("should be the compiler's output when there is one", () => {
			expect(
				new ConfigSet("game", robloxTs, false).syncDirBy(darklua)
			).toBe("out");
		});

		it("should be none for plain Luau", () => {
			expect(
				new ConfigSet("game", luau, false).syncDirBy(darklua)
			).toBeUndefined();
		});
	});
});
