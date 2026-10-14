import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { RojoNode } from "../../rojo/rojo-project.js";
import { SyncTool } from "../../toolchain/toolchain.js";
import {
	FOLDER,
	abs,
	assembleFilesOf,
	optional,
	writeFiles,
} from "./fixtures.js";

describe("TreeAssembler", () => {
	describe("tree", () => {
		let fs: MemoryFileSystemService;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const assemble = (
			overrides: ResolvedConfigSpec = {},
			extraTools: readonly SyncTool[] = []
		) => assembleFilesOf(fs, overrides, extraTools);

		const storageOf = async (overrides: ResolvedConfigSpec = {}) =>
			(await assemble(overrides)).projectFile.tree
				.ReplicatedStorage as RojoNode;

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		describe("tree", () => {
			it("should start from a bare DataModel without a name when the config sets none", async () => {
				const { projectFile: value } = await assemble({
					name: "game",
				});

				expect(value).toEqual({ tree: { $className: "DataModel" } });
			});

			it("should keep the config's other fields and nodes", async () => {
				const project = {
					name: "game",
					servePort: 34872,
					tree: {
						$className: "DataModel",
						Workspace: { $className: "Workspace" },
					},
				};

				const { projectFile: value } = await assemble({ project });

				expect(value).toEqual({
					name: "game",
					servePort: 34872,
					tree: {
						$className: "DataModel",
						Workspace: { $className: "Workspace" },
					},
				});
			});

			it("should merge generated children under a tree service that has its own $path", async () => {
				await write("src/Foo.luau");
				const project = {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { $path: "shared" },
					},
				};

				const storage = await storageOf({ project });

				expect(storage).toEqual({
					$path: "shared",
					Foo: { $path: optional("src/Foo.luau") },
				});
			});

			it("should keep a tree $path as written and never move it under the sync path", async () => {
				await write("src/Foo.ts");
				const project = {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Packages: { $path: "Packages" },
							Vendor: { $path: optional("vendor") },
						},
					},
				};

				const storage = await storageOf({
					project,
					syncPath: abs("dist"),
				});

				expect(storage.Packages).toEqual({ $path: "Packages" });
				expect(storage.Vendor).toEqual({ $path: optional("vendor") });
			});

			it("should keep a tree $path written with a leading dot as written", async () => {
				const project = {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Packages: { $path: "./Packages" },
						},
					},
				};

				const storage = await storageOf({ project });

				expect(storage.Packages).toEqual({ $path: "./Packages" });
			});

			it("should merge files under a tree $path that a route targets", async () => {
				await write("src/A.luau", "src/B.luau");
				const project = {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Vendor: { $path: "vendor" } },
					},
				};

				const { projectFile: value, warnings } = await assemble({
					routes: { "*": "ReplicatedStorage/Vendor" },
					project,
				});

				expect(
					(value.tree.ReplicatedStorage as RojoNode).Vendor
				).toEqual({
					$path: "vendor",
					A: { $path: optional("src/A.luau") },
					B: { $path: optional("src/B.luau") },
				});
				expect(warnings).toEqual([]);
			});

			it("should keep the tree's node and warn when a generated instance clashes", async () => {
				await write("src/Packages/A.luau", "src/Packages/B.luau");
				const project = {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Packages: { $path: "Packages" } },
					},
				};

				const { projectFile: value, warnings } = await assemble({
					project,
				});

				expect(
					(value.tree.ReplicatedStorage as RojoNode).Packages
				).toEqual({ $path: "Packages" });
				expect(warnings).toEqual([
					{
						severity: DiagnosticSeverity.Warning,
						code: "tree.nodeClash",
						resource: abs("src/Packages"),
						message:
							'the tree defines "ReplicatedStorage/Packages" too, so its node is kept and this folder is left out. Rename one of them to keep both.',
					},
				]);
			});
		});

		describe("paths", () => {
			it("should emit generated $paths in the optional form, relative to the config's folder", async () => {
				await write("src/Foo.luau");

				const storage = await storageOf();

				expect(storage.Foo).toEqual({
					$path: optional("src/Foo.luau"),
				});
			});

			it("should emit generated $paths relative to the folder of a config that sits above its sources", async () => {
				await writeFiles(fs, "place/src/Foo.luau");

				const storage = await storageOf({
					file: abs("place/rogen.json"),
					sourcePaths: [abs("place/src")],
				});

				expect(storage.Foo).toEqual({
					$path: optional("src/Foo.luau"),
				});
			});

			it("should apply the sync-path rule when a sync path is set", async () => {
				await write("src/Foo.ts", "src/Bar.luau");

				const storage = await storageOf({ syncPath: abs("dist") });

				expect(storage).toMatchObject({
					Foo: { $path: optional("dist/Foo.luau") },
					Bar: { $path: optional("dist/Bar.luau") },
				});
			});

			it("should create a service node for each service and folders below it", async () => {
				await write("src/Combat.luau");

				const { projectFile: value } = await assemble({
					routes: { "*": "ServerScriptService/server" },
				});

				expect(value.tree.ServerScriptService).toEqual({
					$className: "ServerScriptService",
					server: {
						...FOLDER,
						Combat: { $path: optional("src/Combat.luau") },
					},
				});
			});

			it("should create StarterPlayer's script containers with their own class", async () => {
				await write("src/Hud.client.luau");

				const { projectFile: value } = await assemble({
					routes: { "*": "StarterPlayer/StarterPlayerScripts" },
				});

				expect(value.tree.StarterPlayer).toEqual({
					$className: "StarterPlayer",
					StarterPlayerScripts: {
						$className: "StarterPlayerScripts",
						Hud: { $path: optional("src/Hud.client.luau") },
					},
				});
			});
		});

		describe("run context targets", () => {
			const runContextWarnings = async (
				routes: Record<string, string>,
				emitLegacyScripts?: boolean
			) => {
				await write("src/Hud.client.luau");
				const project = {
					tree: { $className: "DataModel" },
					...(emitLegacyScripts !== undefined && {
						emitLegacyScripts,
					}),
				};
				const { warnings } = await assemble({ routes, project });
				return warnings.filter(
					({ code }) => code === "tree.runContextTarget"
				);
			};

			it.each([
				"StarterPlayer/StarterPlayerScripts",
				"StarterPlayer/StarterCharacterScripts",
				"StarterPlayer/StarterPlayerScripts/Ui",
			])(
				"should warn when emitLegacyScripts is false and a route targets %s",
				async (target) => {
					const warnings = await runContextWarnings(
						{ "*": "ReplicatedStorage", client: target },
						false
					);

					expect(warnings).toHaveLength(1);
					expect(warnings[0]).toMatchObject({
						resource: abs("default.project.json"),
					});
					expect(warnings[0].message).toContain(`"client"`);
					expect(warnings[0].message).toContain(target);
					expect(warnings[0].message).toContain("emitLegacyScripts");
				}
			);

			it("should warn once per config, naming every offending route", async () => {
				const warnings = await runContextWarnings(
					{
						client: "StarterPlayer/StarterPlayerScripts",
						character: "StarterPlayer/StarterCharacterScripts",
						"*": "ReplicatedStorage",
					},
					false
				);

				expect(warnings).toHaveLength(1);
				expect(warnings[0].message).toContain(`"client"`);
				expect(warnings[0].message).toContain(`"character"`);
			});

			it.each([undefined, true])(
				"should not warn when emitLegacyScripts is %s",
				async (emitLegacyScripts) => {
					const warnings = await runContextWarnings(
						{ client: "StarterPlayer/StarterPlayerScripts" },
						emitLegacyScripts
					);

					expect(warnings).toEqual([]);
				}
			);

			it("should not warn when no route targets those containers", async () => {
				const warnings = await runContextWarnings(
					{
						client: "ReplicatedStorage/client",
						server: "StarterGui",
					},
					false
				);

				expect(warnings).toEqual([]);
			});

			it("should not warn when the config says nothing about legacy scripts", async () => {
				await write("src/Hud.client.luau");

				const { warnings } = await assemble({
					routes: { "*": "StarterPlayer/StarterPlayerScripts" },
				});

				expect(warnings).toEqual([]);
			});

			it("should still write the tree", async () => {
				await write("src/Hud.client.luau");
				const project = {
					tree: { $className: "DataModel" },
					emitLegacyScripts: false,
				};

				const { projectFile: value } = await assemble({
					routes: { "*": "StarterPlayer/StarterPlayerScripts" },
					project,
				});

				expect(value.emitLegacyScripts).toBe(false);
				expect(value.tree.StarterPlayer).toBeDefined();
			});
		});

		describe("tree nodes", () => {
			it("should not collapse a directory onto a tree container, so its children merge", async () => {
				await write("src/Inventory/Save.luau");
				const project = {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Inventory: {
								$className: "Folder",
								Extra: { $path: "extra" },
							},
						},
					},
				};

				const { projectFile: value, warnings } = await assemble({
					project,
				});

				expect(warnings).toEqual([]);
				expect(
					(value.tree.ReplicatedStorage as RojoNode).Inventory
				).toEqual({
					$className: "Folder",
					Extra: { $path: "extra" },
					Save: { $path: optional("src/Inventory/Save.luau") },
				});
			});

			it("should never collapse over a tree $path, whatever the directory holds", async () => {
				await write("src/Packages/A.luau", "src/Packages/B.luau");
				const project = {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Packages: { $path: optional("Packages") },
						},
					},
				};

				const storage = await storageOf({ project });

				expect(storage.Packages).toEqual({
					$path: optional("Packages"),
				});
			});
		});

		describe("generated folders", () => {
			it("should give every folder Rogen creates a Folder class and $ignoreUnknownInstances false", async () => {
				await write("src/A/Other.luau", "src/A/B/(x)/C.luau");

				const storage = await storageOf({
					routes: { "*": "ReplicatedStorage/shared" },
				});

				const shared = storage.shared as RojoNode;
				expect(shared).toMatchObject(FOLDER);
				expect(shared.A).toMatchObject(FOLDER);
			});

			it("should leave tree nodes as written", async () => {
				await write("src/Foo.luau");
				const project = {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { shared: { $className: "Folder" } },
					},
				};

				const storage = await storageOf({
					project,
					routes: { "*": "ReplicatedStorage/shared" },
				});

				expect(storage.shared).toEqual({
					$className: "Folder",
					Foo: { $path: optional("src/Foo.luau") },
				});
			});
		});

		describe("data files", () => {
			it("should place a standalone data file as its own instance", async () => {
				await write("src/Items.json", "src/Foo.luau");

				const { projectFile: value, warnings } = await assemble();

				expect(value.tree.ReplicatedStorage).toEqual({
					$className: "ReplicatedStorage",
					Foo: { $path: optional("src/Foo.luau") },
					Items: { $path: optional("src/Items.json") },
				});
				expect(warnings).toEqual([]);
			});

			it("should place a nested project file without collapsing its directory", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Outer.project.json"
				);

				const storage = await storageOf();

				expect(storage.Inventory).toEqual({
					$className: "Folder",
					$ignoreUnknownInstances: false,
					Save: { $path: optional("src/Inventory/Save.luau") },
					Outer: {
						$path: optional("src/Inventory/Outer.project.json"),
					},
				});
			});

			it("should name a .model.json file without the .model", async () => {
				await write("src/Gun.model.json", "src/Foo.luau");

				const storage = await storageOf();

				expect(storage.Gun).toEqual({
					$path: optional("src/Gun.model.json"),
				});
			});
		});

		describe("init scripts", () => {
			const SPLIT = {
				server: "ServerScriptService",
				client: "StarterPlayer/StarterPlayerScripts",
				"*": "ReplicatedStorage",
			};

			it("should point every node an init script is at its directory, and keep what sits beside it out of that read", async () => {
				await write(
					"src/Net/init.luau",
					"src/Net/Types.luau",
					"src/Net/server/Remote.luau",
					"src/Net/client/Listener.luau"
				);
				await fs.writeFile(
					abs("src/Net/init.meta.json"),
					JSON.stringify({ attributes: { Remote: true } })
				);

				const { projectFile: value } = await assemble({
					routes: SPLIT,
				});

				expect(value.tree.ReplicatedStorage).toEqual({
					$className: "ReplicatedStorage",
					Net: {
						$path: optional("src/Net"),
						Types: { $path: optional("src/Net/Types.luau") },
					},
				});
				expect(value.tree.ServerScriptService).toEqual({
					$className: "ServerScriptService",
					Net: {
						$path: optional("src/Net"),
						Remote: {
							$path: optional("src/Net/server/Remote.luau"),
						},
					},
				});
				expect([...(value.globIgnorePaths ?? [])].sort()).toEqual([
					"src/Net/Types.luau",
					"src/Net/client",
					"src/Net/server",
				]);
			});

			it("should point at the directory roblox-ts writes an index script's init into", async () => {
				await write("src/Lib/index.ts", "src/Lib/server/Api.ts");

				const { projectFile: value } = await assemble({
					routes: SPLIT,
					syncPath: abs("out"),
				});

				expect(
					(value.tree.ServerScriptService as RojoNode).Lib
				).toEqual({
					$path: optional("out/Lib"),
					Api: { $path: optional("out/Lib/server/Api.luau") },
				});
				expect(value.globIgnorePaths).toEqual(["out/Lib/server"]);
			});
		});
	});
});
