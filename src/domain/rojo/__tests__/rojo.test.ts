import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import {
	RojoFile,
	RojoMeta,
	childrenBesideInit,
	scriptRunOf,
} from "../rojo.js";
import { SyncRule, SyncRules } from "../sync-rules.js";

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
				["Config.jsonc", "data"],
				["Gun.model.jsonc", "data"],
				["Config.toml", "data"],
				["Table.csv", "data"],
				["Notes.txt", "data"],
				["Config.yaml", "data"],
				["Config.yml", "data"],
			])("should read %s as a %s", (name, kind) => {
				expect(new RojoFile(name, SyncRules.DEFAULT).kind).toBe(kind);
			});

			it.each([
				"Types.d.ts",
				"SAVE.LUAU",
				"Save.Json",
				"Save.META.JSON",
				"Save.meta.json",
				"Save.meta.jsonc",
				"init.meta.json",
				"init.meta.jsonc",
				"Notes.md",
				".server",
				"README",
			])("should not read %s as an instance", (name) => {
				expect(
					new RojoFile(name, SyncRules.DEFAULT).kind
				).toBeUndefined();
			});
		});

		describe("isLuau", () => {
			it.each(["Save.luau", "Save.lua", "Save.server.luau", "init.luau"])(
				"should be true for %s",
				(name) => {
					expect(new RojoFile(name, SyncRules.DEFAULT).isLuau).toBe(
						true
					);
				}
			);

			it.each(["Save.ts", "Hud.tsx", "Data.json", "Model.rbxm"])(
				"should be false for %s",
				(name) => {
					expect(new RojoFile(name, SyncRules.DEFAULT).isLuau).toBe(
						false
					);
				}
			);
		});

		describe("isLuauModule", () => {
			it.each(["Save.luau", "Save.lua", "init.luau", "Hit.mock.luau"])(
				"should be true for %s",
				(name) => {
					expect(
						new RojoFile(name, SyncRules.DEFAULT).isLuauModule
					).toBe(true);
				}
			);

			it.each([
				"Save.server.luau",
				"Hud.client.lua",
				"Tool.plugin.luau",
				"Save.ts",
				"Hud.tsx",
				"Data.json",
				"Model.rbxm",
			])("should be false for %s", (name) => {
				expect(new RojoFile(name, SyncRules.DEFAULT).isLuauModule).toBe(
					false
				);
			});
		});

		describe("isMeta", () => {
			it("should accept a meta file in lowercase only, and reject other JSON", () => {
				expect(
					new RojoFile("Save.meta.json", SyncRules.DEFAULT).isMeta
				).toBe(true);
				expect(
					new RojoFile(RojoFile.INIT_META, SyncRules.DEFAULT).isMeta
				).toBe(true);
				expect(
					new RojoFile("Save.meta.jsonc", SyncRules.DEFAULT).isMeta
				).toBe(true);
				expect(
					new RojoFile(RojoFile.INIT_META_JSONC, SyncRules.DEFAULT)
						.isMeta
				).toBe(true);
				expect(
					new RojoFile("SAVE.META.JSON", SyncRules.DEFAULT).isMeta
				).toBe(false);
				expect(
					new RojoFile("Save.json", SyncRules.DEFAULT).isMeta
				).toBe(false);
			});
		});

		describe("lowercasedExtension", () => {
			it.each([
				["Save.LUAU", "Save.luau"],
				["Save.Rbxm", "Save.rbxm"],
				["Save.JSON", "Save.json"],
				["Save.MODEL.JSON", "Save.model.json"],
				["Save.Project.Json", "Save.project.json"],
				["Save.META.JSON", "Save.meta.json"],
				["Save.Server.luau", undefined],
				["Save.luau", undefined],
				["Notes.MD", undefined],
				["Types.D.TS", undefined],
			])("should read %s as %s", (name, fixed) => {
				expect(
					new RojoFile(name, SyncRules.DEFAULT).lowercasedExtension
				).toBe(fixed);
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
				expect(new RojoFile(name, SyncRules.DEFAULT).isInit).toBe(true);
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
				expect(new RojoFile(name, SyncRules.DEFAULT).isInit).toBe(
					false
				);
			});
		});

		describe("with sync rules of the project", () => {
			const rules = (...own: SyncRule[]) =>
				SyncRules.following(own, "/repo");

			it("should read a file by the rule that takes it", () => {
				const file = new RojoFile(
					"Combat.module",
					rules({
						pattern: "*.module",
						use: "moduleScript",
						suffix: ".module",
					})
				);

				expect(file.kind).toBe("script");
				expect(file.stem).toBe("Combat");
				expect(file.instanceName).toBe("Combat");
				expect(file.metaFiles).toEqual([
					"Combat.meta.jsonc",
					"Combat.meta.json",
				]);
			});

			it("should give a script the class its rule gives it", () => {
				const file = new RojoFile(
					"Menu.hud",
					rules({
						pattern: "*.hud",
						use: "clientScript",
						suffix: ".hud",
					})
				);

				expect(file.kind).toBe("script");
				expect(file.scriptSuffix).toBe("client");
				expect(file.instanceName).toBe("Menu");
			});

			it("should keep a name that ends like a script suffix when the rule cut it", () => {
				const file = new RojoFile(
					"Foo.server.module",
					rules({
						pattern: "*.module",
						use: "moduleScript",
						suffix: ".module",
					})
				);

				expect(file.scriptSuffix).toBeUndefined();
				expect(file.isLuauModule).toBe(true);
				expect(file.instanceName).toBe("Foo.server");
				expect(file.metaFiles).toEqual([
					"Foo.server.meta.jsonc",
					"Foo.server.meta.json",
				]);
			});

			it("should name a data file by the cut name even when it ends like a model", () => {
				const file = new RojoFile(
					"Gun.model.json",
					rules({ pattern: "*.json", use: "json", suffix: ".json" })
				);

				expect(file.kind).toBe("data");
				expect(file.dataName).toBe("Gun.model");
				expect(file.instanceName).toBe("Gun.model");
			});

			it("should match a rule against the folder the file sits in", () => {
				const rule: SyncRule = { pattern: "docs/*.md", use: "text" };

				expect(new RojoFile("A.md", rules(rule), "docs").kind).toBe(
					"data"
				);
				expect(
					new RojoFile("A.md", rules(rule), "src").kind
				).toBeUndefined();
			});

			it("should read an ignored file as nothing and say which rule ignores it", () => {
				const rule: SyncRule = { pattern: "*.skip", use: "ignore" };
				const file = new RojoFile("Draft.skip", rules(rule));

				expect(file.kind).toBeUndefined();
				expect(file.ignoredBy).toBe(rule);
			});

			it("should say when the suffix of its rule does not end the name", () => {
				const rule: SyncRule = {
					pattern: "*.md",
					use: "text",
					suffix: ".txt",
				};
				const file = new RojoFile("Notes.md", rules(rule));

				expect(file.suffixMissedBy).toBe(rule);
				expect(file.instanceName).toBe("Notes.md");
			});

			it("should leave an init script to Rojo's rules", () => {
				const file = new RojoFile(
					"init.server.luau",
					rules({ pattern: "*.luau", use: "text" })
				);

				expect(file.kind).toBe("script");
				expect(file.isInit).toBe(true);
				expect(file.ownRule).toBeUndefined();
			});

			it("should read a file no rule of the project takes as Rojo does", () => {
				const file = new RojoFile(
					"Save.server.luau",
					rules({ pattern: "*.module", use: "moduleScript" })
				);

				expect(file.kind).toBe("script");
				expect(file.ownRule).toBeUndefined();
				expect(file.instanceName).toBe("Save");
			});

			it("should read a nested project", () => {
				expect(
					new RojoFile("Sub.project.json", SyncRules.DEFAULT)
						.isProject
				).toBe(true);
				expect(
					new RojoFile("Sub.model.json", SyncRules.DEFAULT).isProject
				).toBe(false);
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

		describe("dataName", () => {
			it.each([
				["Crate.model.json", "Crate"],
				["Outer.project.json", "Outer"],
				["Data.model.toml", "Data.model"],
				["Names.project.csv", "Names.project"],
			])("should name %s as %s", (fileName, name) => {
				expect(new RojoFile(fileName, SyncRules.DEFAULT).dataName).toBe(
					name
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
				["Config.jsonc", "Config"],
				["Gun.rbxm", "Gun"],
				["Data.model.toml", "Data.model"],
			])("should name %s as %s", (fileName, name) => {
				expect(
					new RojoFile(fileName, SyncRules.DEFAULT).instanceName
				).toBe(name);
			});
		});

		describe("metaName", () => {
			it.each([
				["Save.server.luau", "Save"],
				["Types.luau", "Types"],
				["Foo.server.mock.luau", "Foo.server.mock"],
				["Config.json", "Config"],
				["Config.jsonc", "Config"],
				["Notes.txt", "Notes"],
			])("should read the meta of %s under %s", (fileName, name) => {
				expect(new RojoFile(fileName, SyncRules.DEFAULT).metaName).toBe(
					name
				);
			});

			it.each(["Crate.model.json", "Nested.project.json", "Gun.rbxm"])(
				"should give %s no meta",
				(fileName) => {
					expect(
						new RojoFile(fileName, SyncRules.DEFAULT).metaName
					).toBeUndefined();
				}
			);

			it("should read .model and .project as part of the name outside .json files", () => {
				expect(
					new RojoFile("Crate.model.toml", SyncRules.DEFAULT).metaName
				).toBe("Crate.model");
			});
		});

		describe("metaStemOf", () => {
			it("should strip either meta suffix, and none from another file", () => {
				expect(RojoFile.metaStemOf("Save.meta.json")).toBe("Save");
				expect(RojoFile.metaStemOf("Save.meta.jsonc")).toBe("Save");
				expect(RojoFile.metaStemOf("Save.json")).toBeUndefined();
			});
		});

		describe("metaFiles", () => {
			it("should name the .jsonc Rojo applies over the .json first", () => {
				expect(
					new RojoFile("Save.luau", SyncRules.DEFAULT).metaFiles
				).toEqual(["Save.meta.jsonc", "Save.meta.json"]);
				expect(
					new RojoFile("Gun.rbxm", SyncRules.DEFAULT).metaFiles
				).toEqual([]);
			});
		});

		describe("metaFile", () => {
			it("should name the meta file Rojo reads for a script", () => {
				expect(
					new RojoFile("Save.server.luau", SyncRules.DEFAULT).metaFile
				).toBe("Save.meta.json");
			});

			it("should name none for a file that takes no meta", () => {
				expect(
					new RojoFile("Gun.rbxm", SyncRules.DEFAULT).metaFile
				).toBeUndefined();
			});
		});
	});

	describe("RojoMeta", () => {
		describe("parse", () => {
			it("should refuse a byte order mark, which Rojo can't read", () => {
				const result = RojoMeta.parse(
					'\uFEFF{"className":"Folder"}',
					"a/init.meta.json"
				);

				expect(result.isErr() && result.error).toMatchObject([
					{
						code: "meta.byteOrderMark",
						resource: "a/init.meta.json",
					},
				]);
			});

			it("should keep the fields Rojo reads and drop the rest", () => {
				const parsed = RojoMeta.parse(
					'{ "$schema": "x", "className": "Actor", "properties": { "RunContext": "Client" } }',
					"/repo/A.meta.json"
				);

				expect(parsed.unwrap().fields).toEqual({
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

		describe("typos", () => {
			const typosOf = (text: string, file: string) => {
				const parsed = RojoMeta.parse(text, file);
				return parsed.isOk() ? parsed.value.typos : [];
			};

			it("should warn of a field that is one slip from a field Rojo reads, where it is written", () => {
				const warnings = typosOf(
					'{\n  "classname": "Actor",\n  "attributs": {}\n}',
					"/repo/A.meta.json"
				);

				expect(warnings).toMatchObject([
					{
						code: "meta.unknownField",
						severity: DiagnosticSeverity.Warning,
						resource: "/repo/A.meta.json",
						position: { line: 2, column: 3 },
						message:
							'unknown field "classname"; Rojo ignores it. Did you mean "className"?',
					},
					{
						message:
							'unknown field "attributs"; Rojo ignores it. Did you mean "attributes"?',
					},
				]);
			});

			it("should stay silent about a field that resembles none, such as $schema", () => {
				expect(
					typosOf(
						'{ "$schema": "x", "comment": "y", "className": "Actor" }',
						"/repo/A.meta.json"
					)
				).toEqual([]);
			});

			it("should not warn when the meta can't be read at all", () => {
				expect(typosOf("{bad", "/repo/A.meta.json")).toEqual([]);
				expect(typosOf("[]", "/repo/A.meta.json")).toEqual([]);
			});
		});

		describe("merged", () => {
			it("should merge properties and let the later meta replace any other field", () => {
				expect(
					RojoMeta.merged(
						{
							className: "Actor",
							properties: { A: 1, B: 1 },
							attributes: { x: 1 },
						},
						{ properties: { B: 2 }, attributes: { y: 2 }, id: "i" }
					)
				).toEqual({
					className: "Actor",
					properties: { A: 1, B: 2 },
					attributes: { y: 2 },
					id: "i",
				});
			});

			it("should leave properties out when neither meta has any", () => {
				expect(RojoMeta.merged({ className: "Folder" }, {})).toEqual({
					className: "Folder",
				});
			});
		});

		describe("fieldsUnder", () => {
			it("should let the project's fields win, and merge properties with the project's winning", () => {
				expect(
					RojoMeta.fieldsUnder(
						{
							className: "Actor",
							properties: { A: 1, B: 1 },
							attributes: { X: 1 },
							id: "meta",
						},
						{
							$className: "Folder",
							$properties: { B: 2 },
							$id: "node",
						}
					)
				).toEqual({
					$properties: { A: 1, B: 2 },
					$attributes: { X: 1 },
				});
			});

			it("should add nothing for an empty meta", () => {
				expect(
					RojoMeta.fieldsUnder({}, { $className: "Folder" })
				).toEqual({});
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

			expect(
				childrenBesideInit(
					listing,
					"init.luau",
					(name) => new RojoFile(name, SyncRules.DEFAULT)
				)
			).toEqual(["Helper.luau", "Data.json", "Moves", "Linked"]);
		});

		it("should count a file that only a sync rule of the project reads", () => {
			const rules = SyncRules.following(
				[{ pattern: "*.note", use: "text" }],
				"/repo"
			);
			const listing = new Map([
				["init.luau", FileType.File],
				["Greeting.note", FileType.File],
				["README.md", FileType.File],
			]);

			expect(
				childrenBesideInit(
					listing,
					"init.luau",
					(name) => new RojoFile(name, rules)
				)
			).toEqual(["Greeting.note"]);
		});
	});
});
