import {
	INIT_META_FILE,
	SCRIPT_EXTENSIONS,
	classifyFile,
	isInitScript,
	isMetaFile,
} from "../rojo-files.js";

describe("domain/rojo/rojo-files", () => {
	describe("classifyFile", () => {
		it.each([
			["Save.luau", "script"],
			["Save.lua", "script"],
			["Save.ts", "script"],
			["View.tsx", "script"],
			["Save.server.luau", "script"],
			["Model.rbxm", "model"],
			["Model.rbxmx", "model"],
			["Config.json", "data"],
			["Config.toml", "data"],
			["Table.csv", "data"],
			["Notes.txt", "data"],
			["Config.yaml", "data"],
			["Config.yml", "data"],
			["SAVE.LUAU", "script"],
		])("should read %s as a %s", (name, kind) => {
			expect(classifyFile(name)).toBe(kind);
		});

		it.each([
			"Types.d.ts",
			"Save.meta.json",
			"init.meta.json",
			"Notes.md",
			".server",
			"README",
		])("should not read %s as an instance", (name) => {
			expect(classifyFile(name)).toBeUndefined();
		});
	});

	describe("isMetaFile", () => {
		it("should accept a meta file in any case and reject other JSON", () => {
			expect(isMetaFile("Save.meta.json")).toBe(true);
			expect(isMetaFile(INIT_META_FILE)).toBe(true);
			expect(isMetaFile("SAVE.META.JSON")).toBe(true);
			expect(isMetaFile("Save.json")).toBe(false);
		});
	});

	describe("isInitScript", () => {
		it.each([
			"init.luau",
			"index.ts",
			"init.server.luau",
			"init.client.lua",
			"Init.luau",
		])("should accept %s", (name) => {
			expect(isInitScript(name)).toBe(true);
		});

		it.each(["init.json", "initial.luau", "Save.luau", "init.meta.json"])(
			"should reject %s",
			(name) => {
				expect(isInitScript(name)).toBe(false);
			}
		);
	});

	describe("SCRIPT_EXTENSIONS", () => {
		it("should list the extensions Rojo reads as scripts", () => {
			expect([...SCRIPT_EXTENSIONS]).toEqual([
				".luau",
				".lua",
				".ts",
				".tsx",
			]);
		});
	});
});
