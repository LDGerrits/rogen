import { FileType } from "../../../platform/fs/file-system-service.js";
import {
	RojoFile,
	RojoMeta,
	childrenBesideInit,
	scriptRunOf,
} from "../rojo.js";

describe("domain/rojo/rojo", () => {
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

		describe("isInit", () => {
			it.each([
				"init.luau",
				"init.lua",
				"init.server.luau",
				"init.client.lua",
				"init.plugin.luau",
			])("should accept %s", (name) => {
				expect(new RojoFile(name).isInit).toBe(true);
			});

			it.each([
				"Init.luau",
				"index.ts",
				"index.luau",
				"init.mock.luau",
				"init.local.luau",
				"init@server.luau",
				"init.json",
				"initial.luau",
				"init.meta.json",
			])("should reject %s", (name) => {
				expect(new RojoFile(name).isInit).toBe(false);
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

		describe("scriptSuffixOf", () => {
			it.each(["server", "client", "plugin"])(
				"should read a trailing .%s",
				(suffix) => {
					expect(RojoFile.scriptSuffixOf(`main.${suffix}`)).toBe(
						suffix
					);
				}
			);

			it("should ignore a suffix that isn't right before the extension", () => {
				expect(
					RojoFile.scriptSuffixOf("Foo.server.mock")
				).toBeUndefined();
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

	describe("RojoMeta", () => {
		describe("parse", () => {
			it("should keep the fields Rojo reads and drop the rest", () => {
				const parsed = RojoMeta.parse(
					'{ "$schema": "x", "className": "Actor", "properties": { "RunContext": "Client" } }',
					"/repo/A.meta.json"
				);

				expect(parsed.unwrap()).toEqual({
					className: "Actor",
					properties: { RunContext: "Client" },
				});
			});

			it("should fail on a meta file that isn't an object", () => {
				const parsed = RojoMeta.parse("[]", "/repo/A.meta.json");

				expect(parsed.isErr() && parsed.error).toMatchObject([
					{ code: "meta.notAnObject" },
				]);
			});
		});
	});

	describe("scriptRunOf", () => {
		it("should run a script by its class while legacy scripts are on", () => {
			expect(scriptRunOf("server", true, undefined)).toBe("Script");
			expect(scriptRunOf("client", true, "Server")).toBe("LocalScript");
		});

		it("should run a script by its run context once legacy scripts are off", () => {
			expect(scriptRunOf("server", false, undefined)).toBe("Server");
			expect(scriptRunOf("client", false, undefined)).toBe("Client");
		});

		it("should let a Script's meta set its run context", () => {
			expect(scriptRunOf("server", true, "Client")).toBe("Client");
			expect(scriptRunOf("server", false, "Legacy")).toBe("Script");
			expect(scriptRunOf("server", true, "Bogus")).toBe("Script");
		});

		it("should give no run for a file that isn't a server or client script", () => {
			expect(scriptRunOf(undefined, true, "Server")).toBeUndefined();
			expect(scriptRunOf("plugin", true, undefined)).toBeUndefined();
		});
	});

	describe("childrenBesideInit", () => {
		it("should give every directory and every other file that is an instance on its own", () => {
			const listing = new Map([
				["init.luau", FileType.File],
				["init.meta.json", FileType.File],
				["Helper.luau", FileType.File],
				["Data.json", FileType.File],
				["Types.d.ts", FileType.File],
				["README.md", FileType.File],
				["Moves", FileType.Directory],
				["Linked", FileType.SymbolicLink | FileType.Directory],
			]);

			expect(childrenBesideInit(listing, "init.luau")).toEqual([
				"Helper.luau",
				"Data.json",
				"Moves",
				"Linked",
			]);
		});
	});
});
