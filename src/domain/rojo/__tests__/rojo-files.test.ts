import {
	INIT_META_FILE,
	SCRIPT_EXTENSIONS,
	classifyFile,
	isInitScript,
	isMetaFile,
	rojoAssignedName,
	rojoFileName,
	rojoMetaFile,
	rojoMetaName,
	rojoModelName,
	stripRojoDataSuffix,
	suffixSeparator,
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

describe("suffixSeparator", () => {
	it.each(["server", "client", "plugin"])(
		"should use a dash for %s on a script, which Rojo reads as the class",
		(key) => {
			expect(suffixSeparator("script", key)).toBe("-");
		}
	);

	it("should compare a script key without regard to case", () => {
		expect(suffixSeparator("script", "Server")).toBe("-");
	});

	it.each(["shared", "mock", "dev"])(
		"should use a dot for %s on a script",
		(key) => {
			expect(suffixSeparator("script", key)).toBe(".");
		}
	);

	it.each(["model", "project"])(
		"should use a dash for %s on a data file, which Rojo reads as a model or a project",
		(key) => {
			expect(suffixSeparator("data", key)).toBe("-");
		}
	);

	it("should use a dot for a script class name on a data file or a model", () => {
		expect(suffixSeparator("data", "server")).toBe(".");
		expect(suffixSeparator("model", "server")).toBe(".");
		expect(suffixSeparator("model", "model")).toBe(".");
	});
});

describe("rojoAssignedName", () => {
	it("strips a trailing .client", () => {
		expect(rojoAssignedName("main.client")).toBe("main");
	});

	it("strips a trailing .plugin", () => {
		expect(rojoAssignedName("main.plugin")).toBe("main");
	});

	it("strips a trailing .server", () => {
		expect(rojoAssignedName("main.server")).toBe("main");
	});

	it("leaves a non-trailing .server untouched, matching Rojo", () => {
		expect(rojoAssignedName("Foo.server.mock")).toBe("Foo.server.mock");
	});

	it("leaves any other suffix untouched", () => {
		expect(rojoAssignedName("Types.shared")).toBe("Types.shared");
	});

	it("does not know about declared keys at all", () => {
		expect(rojoAssignedName("Save+mock.server")).toBe("Save+mock");
	});
});

describe("rojoModelName", () => {
	it("strips a trailing .model", () => {
		expect(rojoModelName("Gun.model")).toBe("Gun");
	});

	it("leaves any other stem untouched", () => {
		expect(rojoModelName("Gun")).toBe("Gun");
		expect(rojoModelName("Gun.model.mock")).toBe("Gun.model.mock");
	});
});

describe("stripRojoDataSuffix", () => {
	it("strips a trailing .model or .project", () => {
		expect(stripRojoDataSuffix("Gun.model")).toBe("Gun");
		expect(stripRojoDataSuffix("Outer.project")).toBe("Outer");
	});

	it("leaves a stem that is only the suffix, and any other stem", () => {
		expect(stripRojoDataSuffix(".model")).toBe(".model");
		expect(stripRojoDataSuffix("Gun.model.mock")).toBe("Gun.model.mock");
	});
});

describe("rojoFileName", () => {
	it.each([
		["script", "Save.server.luau", "Save"],
		["script", "Types.luau", "Types"],
		["script", "Foo.server.mock.luau", "Foo.server.mock"],
		["data", "Crate.model.json", "Crate"],
		["data", "Config.json", "Config"],
		["model", "Gun.rbxm", "Gun"],
	] as const)("should name a %s file %s as %s", (kind, fileName, name) => {
		expect(rojoFileName(kind, fileName)).toBe(name);
	});
});

describe("rojoMetaName", () => {
	it.each([
		["Save.server.luau", "Save"],
		["Types.luau", "Types"],
		["Foo.server.mock.luau", "Foo.server.mock"],
		["Config.json", "Config"],
		["Notes.txt", "Notes"],
	])("should read the meta of %s under %s", (fileName, name) => {
		expect(rojoMetaName(fileName)).toBe(name);
	});

	it.each(["Crate.model.json", "Nested.project.json", "Gun.rbxm"])(
		"should give %s no meta",
		(fileName) => {
			expect(rojoMetaName(fileName)).toBeUndefined();
		}
	);

	it("should read .model and .project as part of the name outside .json files", () => {
		expect(rojoMetaName("Crate.model.toml")).toBe("Crate.model");
	});
});

describe("rojoMetaFile", () => {
	it("should name the meta file Rojo reads for a script", () => {
		expect(rojoMetaFile("Save.server.luau")).toBe("Save.meta.json");
	});

	it("should name none for a file that takes no meta", () => {
		expect(rojoMetaFile("Gun.rbxm")).toBeUndefined();
	});
});
