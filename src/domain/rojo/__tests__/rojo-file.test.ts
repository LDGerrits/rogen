import { RojoFile } from "../rojo-file.js";

describe("domain/rojo/rojo-file", () => {
	describe("RojoFile", () => {
		describe("kind", () => {
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
				expect(new RojoFile(name).kind).toBe(kind);
			});

			it.each([
				"Types.d.ts",
				"Save.meta.json",
				"init.meta.json",
				"Notes.md",
				".server",
				"README",
			])("should not read %s as an instance", (name) => {
				expect(new RojoFile(name).kind).toBeUndefined();
			});
		});

		describe("isMeta", () => {
			it("should accept a meta file in any case and reject other JSON", () => {
				expect(new RojoFile("Save.meta.json").isMeta).toBe(true);
				expect(new RojoFile(RojoFile.INIT_META).isMeta).toBe(true);
				expect(new RojoFile("SAVE.META.JSON").isMeta).toBe(true);
				expect(new RojoFile("Save.json").isMeta).toBe(false);
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
				expect(new RojoFile(name).isInitScript).toBe(true);
			});

			it.each([
				"init.json",
				"initial.luau",
				"Save.luau",
				"init.meta.json",
			])("should reject %s", (name) => {
				expect(new RojoFile(name).isInitScript).toBe(false);
			});
		});

		describe("SCRIPT_EXTENSIONS", () => {
			it("should list the extensions Rojo reads as scripts", () => {
				expect([...RojoFile.SCRIPT_EXTENSIONS]).toEqual([
					".luau",
					".lua",
					".ts",
					".tsx",
				]);
			});
		});

		describe("scriptSuffix", () => {
			it.each(["server", "client", "plugin"])(
				"should read a trailing .%s",
				(suffix) => {
					expect(
						new RojoFile(`main.${suffix}.luau`).scriptSuffix
					).toBe(suffix);
				}
			);

			it("should ignore a suffix that isn't right before the extension", () => {
				expect(
					new RojoFile("Foo.server.mock.luau").scriptSuffix
				).toBeUndefined();
			});
		});

		describe("suffixSeparator", () => {
			const script = new RojoFile("Save.luau");

			it.each(["server", "client", "plugin"])(
				"should use a dash for %s on a script, which Rojo reads as the class",
				(key) => {
					expect(script.suffixSeparator(key)).toBe("-");
				}
			);

			it("should compare a script key without regard to case", () => {
				expect(script.suffixSeparator("Server")).toBe("-");
			});

			it.each(["shared", "mock", "dev"])(
				"should use a dot for %s on a script",
				(key) => {
					expect(script.suffixSeparator(key)).toBe(".");
				}
			);

			it.each(["model", "project"])(
				"should use a dash for %s on a data file, which Rojo reads as a model or a project",
				(key) => {
					expect(
						new RojoFile("Config.json").suffixSeparator(key)
					).toBe("-");
				}
			);

			it("should use a dot for a script class name on a data file or a model", () => {
				const data = new RojoFile("Config.json");
				const model = new RojoFile("Gun.rbxm");

				expect(data.suffixSeparator("server")).toBe(".");
				expect(model.suffixSeparator("server")).toBe(".");
				expect(model.suffixSeparator("model")).toBe(".");
			});
		});

		describe("scriptNameOf", () => {
			it.each(["client", "plugin", "server"])(
				"should strip a trailing .%s",
				(suffix) => {
					expect(RojoFile.scriptNameOf(`main.${suffix}`)).toBe(
						"main"
					);
				}
			);

			it("should leave a non-trailing .server untouched, matching Rojo", () => {
				expect(RojoFile.scriptNameOf("Foo.server.mock")).toBe(
					"Foo.server.mock"
				);
			});

			it("should leave any other suffix untouched", () => {
				expect(RojoFile.scriptNameOf("Types.shared")).toBe(
					"Types.shared"
				);
			});

			it("should not know about declared keys at all", () => {
				expect(RojoFile.scriptNameOf("Save+mock.server")).toBe(
					"Save+mock"
				);
			});
		});

		describe("dataNameOf", () => {
			it("should strip a trailing .model or .project", () => {
				expect(RojoFile.dataNameOf("Gun.model")).toBe("Gun");
				expect(RojoFile.dataNameOf("Outer.project")).toBe("Outer");
			});

			it("should leave a stem that is only the suffix, and any other stem", () => {
				expect(RojoFile.dataNameOf(".model")).toBe(".model");
				expect(RojoFile.dataNameOf("Gun.model.mock")).toBe(
					"Gun.model.mock"
				);
			});
		});

		describe("instanceName", () => {
			it.each([
				["Save.server.luau", "Save"],
				["Types.luau", "Types"],
				["Foo.server.mock.luau", "Foo.server.mock"],
				["Crate.model.json", "Crate"],
				["Config.json", "Config"],
				["Gun.rbxm", "Gun"],
			])("should name %s as %s", (fileName, name) => {
				expect(new RojoFile(fileName).instanceName).toBe(name);
			});
		});

		describe("metaName", () => {
			it.each([
				["Save.server.luau", "Save"],
				["Types.luau", "Types"],
				["Foo.server.mock.luau", "Foo.server.mock"],
				["Config.json", "Config"],
				["Notes.txt", "Notes"],
			])("should read the meta of %s under %s", (fileName, name) => {
				expect(new RojoFile(fileName).metaName).toBe(name);
			});

			it.each(["Crate.model.json", "Nested.project.json", "Gun.rbxm"])(
				"should give %s no meta",
				(fileName) => {
					expect(new RojoFile(fileName).metaName).toBeUndefined();
				}
			);

			it("should read .model and .project as part of the name outside .json files", () => {
				expect(new RojoFile("Crate.model.toml").metaName).toBe(
					"Crate.model"
				);
			});
		});

		describe("metaFile", () => {
			it("should name the meta file Rojo reads for a script", () => {
				expect(new RojoFile("Save.server.luau").metaFile).toBe(
					"Save.meta.json"
				);
			});

			it("should name none for a file that takes no meta", () => {
				expect(new RojoFile("Gun.rbxm").metaFile).toBeUndefined();
			});
		});
	});
});
