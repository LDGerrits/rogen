import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { expectRojoProject } from "../../rojo/__tests__/rojo-schema.js";
import { RojoNode, RojoTree } from "../../rojo/rojo-project.js";
import { SyncTool } from "../build.js";
import { abs, builderOf, configOf, indexOf, writeFiles } from "./fixtures.js";

describe("TreeAssembler", () => {
	const FOLDER = { $className: "Folder", $ignoreUnknownInstances: false };

	const optional = (target: string) => ({ optional: target });

	describe("tree", () => {
		let fs: MemoryFileSystemService;
		let store: DisposableStore;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const assembleResult = async (
			overrides: ResolvedConfigSpec = {},
			extraTools: readonly SyncTool[] = []
		) => {
			const config = configOf(overrides);
			const index = await indexOf(store, fs, config.rootDirs);
			return builderOf(fs, index, extraTools).build(config);
		};

		const assemble = async (
			overrides: ResolvedConfigSpec = {},
			extraTools: readonly SyncTool[] = []
		) => {
			const output = (
				await assembleResult(overrides, extraTools)
			).unwrap();
			expectRojoProject(output.tree);
			return { tree: output.tree, warnings: output.findings.warnings };
		};

		const storageOf = async (overrides: ResolvedConfigSpec = {}) =>
			(await assemble(overrides)).tree.tree.ReplicatedStorage as RojoNode;

		const templateOf = (
			project: Partial<RojoTree>,
			file = abs("default.project.json")
		) => ({ file, project });

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		describe("template", () => {
			it("should start from a bare DataModel with the resolved name when there is no template", async () => {
				const { tree: value } = await assemble({ name: "game" });

				expect(value).toEqual({
					name: "game",
					tree: { $className: "DataModel" },
				});
			});

			it("should keep the template's other fields and nodes", async () => {
				const template = templateOf({
					name: "template-name",
					servePort: 34872,
					tree: {
						$className: "DataModel",
						Workspace: { $className: "Workspace" },
					},
				});

				const { tree: value } = await assemble({
					name: "game",
					template,
				});

				expect(value).toEqual({
					name: "game",
					servePort: 34872,
					tree: {
						$className: "DataModel",
						Workspace: { $className: "Workspace" },
					},
				});
			});

			it("should merge generated children under a template service that has its own $path", async () => {
				await write("src/Foo.luau");
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { $path: "shared" },
					},
				});

				const storage = await storageOf({ template });

				expect(storage).toEqual({
					$path: "shared",
					Foo: { $path: optional("src/Foo.luau") },
				});
			});

			it("should rebase a template $path but never move it under the sync dir", async () => {
				await write("src/Foo.ts");
				const template = templateOf(
					{
						tree: {
							$className: "DataModel",
							ReplicatedStorage: {
								Packages: { $path: "Packages" },
								Vendor: { $path: optional("vendor") },
							},
						},
					},
					abs("templates/base.project.json")
				);

				const storage = await storageOf({
					template,
					syncDir: abs("dist"),
				});

				expect(storage.Packages).toEqual({
					$path: "templates/Packages",
				});
				expect(storage.Vendor).toEqual({
					$path: optional("templates/vendor"),
				});
			});

			it("should leave a template $path as written when the template sits beside the output", async () => {
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Packages: { $path: "./Packages" },
						},
					},
				});

				const storage = await storageOf({ template });

				expect(storage.Packages).toEqual({ $path: "./Packages" });
			});

			it("should merge files under a template $path that a route targets", async () => {
				await write("src/A.luau", "src/B.luau");
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Vendor: { $path: "vendor" } },
					},
				});

				const { tree: value, warnings } = await assemble({
					routes: { "*": "ReplicatedStorage/Vendor" },
					template,
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

			it("should keep the template's node and warn when a generated instance clashes", async () => {
				await write("src/Packages/A.luau", "src/Packages/B.luau");
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Packages: { $path: "Packages" } },
					},
				});

				const { tree: value, warnings } = await assemble({ template });

				expect(
					(value.tree.ReplicatedStorage as RojoNode).Packages
				).toEqual({ $path: "Packages" });
				expect(warnings).toEqual([
					{
						severity: DiagnosticSeverity.Warning,
						code: "tree.templateClash",
						resource: abs("src/Packages"),
						message:
							'the template defines "ReplicatedStorage/Packages" too, so its node is kept and this folder is left out. Rename one of them to keep both.',
					},
				]);
			});
		});

		describe("paths", () => {
			it("should emit generated $paths in the optional form, relative to the output", async () => {
				await write("src/Foo.luau");

				const storage = await storageOf({
					outFile: abs("build/out.project.json"),
				});

				expect(storage.Foo).toEqual({
					$path: optional("../src/Foo.luau"),
				});
			});

			it("should apply the sync-path rule when a sync dir is set", async () => {
				await write("src/Foo.ts", "src/Bar.luau");

				const storage = await storageOf({ syncDir: abs("dist") });

				expect(storage).toMatchObject({
					Foo: { $path: optional("dist/Foo.luau") },
					Bar: { $path: optional("dist/Bar.luau") },
				});
			});

			it("should create a service node for each service and folders below it", async () => {
				await write("src/Combat.luau");

				const { tree: value } = await assemble({
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

				const { tree: value } = await assemble({
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
				const template = templateOf({
					tree: { $className: "DataModel" },
					...(emitLegacyScripts !== undefined && {
						emitLegacyScripts,
					}),
				});
				const { warnings } = await assemble({ routes, template });
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

			it("should not warn without a template", async () => {
				await write("src/Hud.client.luau");

				const { warnings } = await assemble({
					routes: { "*": "StarterPlayer/StarterPlayerScripts" },
				});

				expect(warnings).toEqual([]);
			});

			it("should still write the tree", async () => {
				await write("src/Hud.client.luau");
				const template = templateOf({
					tree: { $className: "DataModel" },
					emitLegacyScripts: false,
				});

				const { tree: value } = await assemble({
					routes: { "*": "StarterPlayer/StarterPlayerScripts" },
					template,
				});

				expect(value.emitLegacyScripts).toBe(false);
				expect(value.tree.StarterPlayer).toBeDefined();
			});
		});

		describe("collapse", () => {
			it("should collapse a directory whose every file is present under Rojo's name", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Load.server.luau"
				);

				const storage = await storageOf();

				expect(storage.Inventory).toEqual({
					$path: optional("src/Inventory"),
				});
			});

			it("should collapse the outermost directory when nested ones would also qualify", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Deep/Load.luau"
				);

				const storage = await storageOf();

				expect(storage).toEqual({
					$className: "ReplicatedStorage",
					Inventory: { $path: optional("src/Inventory") },
				});
			});

			it("should collapse into the sync dir", async () => {
				await write("src/Inventory/Save.ts");

				const storage = await storageOf({ syncDir: abs("dist") });

				expect(storage.Inventory).toEqual({
					$path: optional("dist/Inventory"),
				});
			});

			it("should collapse a directory holding data files, which Rojo names by stem", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Items.json"
				);

				const { tree: value, warnings } = await assemble();

				expect(warnings).toEqual([]);
				expect(
					(value.tree.ReplicatedStorage as RojoNode).Inventory
				).toEqual({ $path: optional("src/Inventory") });
			});

			it("should not collapse an invisible folder into its parent's node", async () => {
				await write("src/Inventory/(group)/Save.luau");

				const storage = await storageOf();

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Save: {
						$path: optional("src/Inventory/(group)/Save.luau"),
					},
				});
			});

			it("should not collapse a routing folder into its parent's node, but collapse a folder inside it", async () => {
				await write(
					"src/Combat/server/Hit.luau",
					"src/Combat/server/Moves/Punch.luau"
				);

				const { tree: value } = await assemble({
					routes: { server: "ServerScriptService" },
				});

				expect(value.tree.ServerScriptService).toEqual({
					$className: "ServerScriptService",
					Combat: {
						...FOLDER,
						Hit: { $path: optional("src/Combat/server/Hit.luau") },
						Moves: { $path: optional("src/Combat/server/Moves") },
					},
				});
			});

			it("should not collapse a routing folder into its route's target folder", async () => {
				await write("src/shared/Types.luau");

				const storage = await storageOf({
					routes: { shared: "ReplicatedStorage/shared" },
				});

				expect(storage.shared).toEqual({
					...FOLDER,
					Types: { $path: optional("src/shared/Types.luau") },
				});
			});

			it("should not collapse an active variant folder into its parent's node", async () => {
				await write("src/Combat/dev/Cheats.luau");

				const storage = await storageOf({ variants: { dev: true } });

				expect(storage.Combat).toEqual({
					...FOLDER,
					Cheats: { $path: optional("src/Combat/dev/Cheats.luau") },
				});
			});

			it("should not collapse a directory holding a skipped link, and ignore the link", async () => {
				await write("src/Real/Thing.luau");
				await fs.createSymbolicLink(abs("src"), abs("src/Real/Back"));
				await fs.createSymbolicLink(
					abs("missing"),
					abs("src/Real/Gone")
				);

				const { tree: value } = await assemble();

				expect((value.tree.ReplicatedStorage as RojoNode).Real).toEqual(
					{
						...FOLDER,
						Thing: { $path: optional("src/Real/Thing.luau") },
					}
				);
				expect(value.globIgnorePaths).toEqual([
					"src/Real/Back",
					"src/Real/Gone",
				]);
			});

			it("should not collapse a directory with a dormant-variant file", async () => {
				await write(
					"src/Inventory/Analytics.luau",
					"src/Inventory/Analytics.mock.luau"
				);

				const storage = await storageOf({ variants: { mock: false } });

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Analytics: {
						$path: optional("src/Inventory/Analytics.luau"),
					},
				});
			});

			it("should not collapse a directory with an excluded file", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Save.spec.luau"
				);

				const storage = await storageOf({
					exclude: [abs("**/*.spec.luau")],
				});

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Save: { $path: optional("src/Inventory/Save.luau") },
				});
			});

			it("should not collapse a directory with an unrouted file", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/Inventory/Hud.client.luau"
				);

				const { tree: value } = await assemble({
					routes: { client: "StarterPlayer/StarterPlayerScripts" },
				});

				expect(value.tree.StarterPlayer).toEqual({
					$className: "StarterPlayer",
					StarterPlayerScripts: {
						$className: "StarterPlayerScripts",
						Inventory: {
							...FOLDER,
							Hud: {
								$path: optional(
									"src/Inventory/Hud.client.luau"
								),
							},
						},
					},
				});
			});

			it("should not collapse a directory holding a file that lost its instance to another root", async () => {
				await write(
					"core/Inventory/Save.luau",
					"core/Inventory/Load.luau"
				);
				await write("mods/Inventory/Save.luau");

				const storage = await storageOf({
					rootDirs: [abs("core"), abs("mods")],
				});

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Save: { $path: optional("mods/Inventory/Save.luau") },
					Load: { $path: optional("core/Inventory/Load.luau") },
				});
			});

			it("should not collapse a directory whose instance another directory also fills", async () => {
				await write(
					"src/Inventory/Save.luau",
					"src/(group)/Inventory/Load.luau"
				);

				const storage = await storageOf();

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Save: { $path: optional("src/Inventory/Save.luau") },
					Load: {
						$path: optional("src/(group)/Inventory/Load.luau"),
					},
				});
			});

			it("should not collapse a directory holding a file Rojo would name differently, and emit it under its instance name", async () => {
				await write("src/Save/Save.mock@server.luau");

				const { tree: value } = await assemble({
					variants: { mock: true },
					routes: { server: "ServerScriptService" },
				});

				expect(value.tree.ServerScriptService).toEqual({
					$className: "ServerScriptService",
					Save: {
						...FOLDER,
						Save: {
							$path: optional("src/Save/Save.mock@server.luau"),
						},
					},
				});
			});

			it("should not collapse a directory holding the file an active variant replaced", async () => {
				await write(
					"src/Inventory/Analytics.luau",
					"src/Inventory/Analytics.mock.luau"
				);

				const storage = await storageOf({ variants: { mock: true } });

				expect(storage.Inventory).toEqual({
					...FOLDER,
					Analytics: {
						$path: optional("src/Inventory/Analytics.mock.luau"),
					},
				});
			});

			it("should not collapse a directory whose file has an @ route suffix", async () => {
				await write("src/Types/Types@shared.luau");

				const storage = await storageOf({
					routes: { shared: "ReplicatedStorage" },
				});

				expect(storage.Types).toEqual({
					...FOLDER,
					Types: { $path: optional("src/Types/Types@shared.luau") },
				});
			});

			it("should never collapse a directory into a service", async () => {
				await write("src/server/Save.luau");

				const { tree: value } = await assemble({
					routes: { server: "ServerScriptService" },
				});

				expect(value.tree.ServerScriptService).toEqual({
					$className: "ServerScriptService",
					Save: { $path: optional("src/server/Save.luau") },
				});
			});

			it("should emit an init folder as one node pointing at the directory", async () => {
				await write(
					"src/Inventory/init.luau",
					"src/Inventory/Save.luau"
				);
				await write("src/Other.luau");

				const storage = await storageOf();

				expect(storage).toMatchObject({
					Inventory: { $path: optional("src/Inventory") },
					Other: { $path: optional("src/Other.luau") },
				});
			});

			it("should ignore .d.ts files when deciding to collapse and never list them", async () => {
				await write("src/Inventory/Save.ts", "src/Inventory/Save.d.ts");

				const { tree: value } = await assemble({
					exclude: [abs("**/*.d.ts")],
				});

				expect(
					(value.tree.ReplicatedStorage as RojoNode).Inventory
				).toEqual({ $path: optional("src/Inventory") });
				expect(value.globIgnorePaths).toBeUndefined();
			});
		});

		it("should keep out of the ignore list whatever a processor says it only reads", async () => {
			await write("src/Inventory/Save.luau", "src/Inventory/Save.proto");

			const { tree: value } = await assemble(
				{ exclude: [abs("**/*.proto")] },
				[
					{
						id: "protobuf",
						readsOnly: (source) => source.endsWith(".proto"),
					},
				]
			);

			expect(value.globIgnorePaths).toBeUndefined();
		});

		describe("template nodes", () => {
			it("should not collapse a directory onto a template container, so its children merge", async () => {
				await write("src/Inventory/Save.luau");
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Inventory: {
								$className: "Folder",
								Extra: { $path: "extra" },
							},
						},
					},
				});

				const { tree: value, warnings } = await assemble({ template });

				expect(warnings).toEqual([]);
				expect(
					(value.tree.ReplicatedStorage as RojoNode).Inventory
				).toEqual({
					$className: "Folder",
					Extra: { $path: "extra" },
					Save: { $path: optional("src/Inventory/Save.luau") },
				});
			});

			it("should never collapse over a template $path, whatever the directory holds", async () => {
				await write("src/Packages/A.luau", "src/Packages/B.luau");
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Packages: { $path: optional("Packages") },
						},
					},
				});

				const storage = await storageOf({ template });

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

			it("should leave template nodes as written", async () => {
				await write("src/Foo.luau");
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { shared: { $className: "Folder" } },
					},
				});

				const storage = await storageOf({
					template,
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

				const { tree: value, warnings } = await assemble();

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

		describe("globIgnorePaths", () => {
			it("should list a pruned file as a sync path", async () => {
				await write(
					"src/Inventory/Analytics.luau",
					"src/Inventory/Analytics.mock.luau"
				);

				const { tree: value } = await assemble({
					syncDir: abs("dist"),
					variants: { mock: false },
				});

				expect(value.globIgnorePaths).toEqual([
					"dist/Inventory/Analytics.mock.luau",
				]);
			});

			it("should never list a path the template mounts, which Rojo has to read", async () => {
				await write(
					"src/Vendor/Lib.luau",
					"src/Save.luau",
					"src/Save.spec.luau"
				);

				const { tree: value } = await assemble({
					exclude: [abs("**/*.spec.luau")],
					template: {
						file: abs("template.project.json"),
						project: {
							name: "game",
							tree: {
								$className: "DataModel",
								ReplicatedStorage: {
									Vendor: { $path: "src/Vendor" },
								},
							},
						},
					},
				});

				expect(value.globIgnorePaths).toEqual(["src/Save.spec.luau"]);
			});

			it("should list excluded and pruned files in path order, translated to sync paths", async () => {
				await write(
					"src/Inventory/Analytics.luau",
					"src/Inventory/Analytics.mock.luau",
					"src/Inventory/Save.spec.ts"
				);

				const { tree: value } = await assemble({
					syncDir: abs("dist"),
					variants: { mock: false },
					exclude: [abs("**/*.spec.ts")],
				});

				expect(value.globIgnorePaths).toEqual([
					"dist/Inventory/Analytics.mock.luau",
					"dist/Inventory/Save.spec.luau",
				]);
			});

			it("should list a file excluded anywhere inside an init folder, and what Rojo would read beside its script", async () => {
				await write(
					"src/Moves/init.ts",
					"src/Moves/Punch.spec.ts",
					"src/Moves/Heavy/Slam.spec.ts"
				);

				const { tree: value } = await assemble({
					syncDir: abs("dist"),
					exclude: [abs("**/*.spec.ts")],
				});

				expect(value.globIgnorePaths).toEqual([
					"dist/Moves/Heavy/Slam.spec.luau",
					"dist/Moves/Punch.spec.luau",
					"dist/Moves/Heavy",
				]);
			});

			it("should list an unrouted file", async () => {
				await write("src/Hud.ts", "src/Combat.server.ts");

				const { tree: value } = await assemble({
					syncDir: abs("dist"),
					routes: { server: "ServerScriptService" },
				});

				expect(value.globIgnorePaths).toEqual(["dist/Hud.luau"]);
			});

			it("should not list a file an active variant replaced, which shares the winner's emitted path", async () => {
				await write("src/Analytics.luau", "src/Analytics.mock.luau");

				const { tree: value } = await assemble({
					variants: { mock: true },
				});

				expect(value.globIgnorePaths).toBeUndefined();
			});

			it("should not list a file the template displaced, which its $path may mount", async () => {
				await write("src/Packages/A.luau", "src/Other/B.luau");
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Packages: { $path: "src/Packages" },
						},
					},
				});

				const { tree: value } = await assemble({ template });

				expect(value.globIgnorePaths).toBeUndefined();
				expect(
					(value.tree.ReplicatedStorage as RojoNode).Other
				).toEqual({
					$path: optional("src/Other"),
				});
			});

			it("should union the template's rebased globs without duplicates", async () => {
				await write("src/Foo.luau", "src/Foo.spec.luau");
				const template = templateOf(
					{
						tree: { $className: "DataModel" },
						globIgnorePaths: [
							"**/*.spec.luau",
							"../src/Foo.spec.luau",
						],
					},
					abs("templates/base.project.json")
				);

				const { tree: value } = await assemble({
					template,
					exclude: [abs("src/Foo.spec.luau")],
				});

				expect(value.globIgnorePaths).toEqual([
					"templates/**/*.spec.luau",
					"src/Foo.spec.luau",
				]);
			});
		});

		describe("folder meta", () => {
			const SPLIT = {
				server: "ServerScriptService",
				client: "StarterPlayer/StarterPlayerScripts",
				"*": "ReplicatedStorage",
			};

			const writeMeta = (file: string, meta: Record<string, unknown>) =>
				fs.writeFile(abs(file), JSON.stringify(meta));

			const nodeAt = (tree: RojoNode, ...segments: string[]) =>
				segments.reduce(
					(node, segment) => node[segment] as RojoNode,
					tree
				);

			it("should copy a split folder's meta onto the node in each service", async () => {
				await write(
					"src/Combat/server/Hit.luau",
					"src/Combat/client/Aim.luau"
				);
				await writeMeta("src/Combat/init.meta.json", {
					className: "Actor",
				});

				const { tree: value, warnings } = await assemble({
					routes: SPLIT,
				});

				expect(warnings).toEqual([]);
				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toEqual({
					$className: "Actor",
					$ignoreUnknownInstances: false,
					Hit: { $path: optional("src/Combat/server/Hit.luau") },
				});
				expect(
					nodeAt(
						value.tree,
						"StarterPlayer",
						"StarterPlayerScripts",
						"Combat"
					)
				).toEqual({
					$className: "Actor",
					$ignoreUnknownInstances: false,
					Aim: { $path: optional("src/Combat/client/Aim.luau") },
				});
			});

			it("should copy nothing onto a collapsed folder or a folder inside it, which Rojo reads itself", async () => {
				await write("src/Bots/Body.luau", "src/Bots/Brain/Think.luau");
				await writeMeta("src/Bots/init.meta.json", {
					className: "Actor",
				});
				await writeMeta("src/Bots/Brain/init.meta.json", {
					className: "Configuration",
				});

				const storage = await storageOf();

				expect(storage.Bots).toEqual({ $path: optional("src/Bots") });
			});

			it("should copy the meta onto a folder a pruned file keeps from collapsing", async () => {
				await write("src/Bots/Body.luau", "src/Bots/Http.mock.luau");
				await writeMeta("src/Bots/init.meta.json", {
					className: "Actor",
				});

				const storage = await storageOf({ variants: { mock: false } });

				expect(storage.Bots).toEqual({
					$className: "Actor",
					$ignoreUnknownInstances: false,
					Body: { $path: optional("src/Bots/Body.luau") },
				});
			});

			it("should copy nothing onto an init folder", async () => {
				await write("src/Bots/init.luau", "src/Other.server.luau");
				await writeMeta("src/Bots/init.meta.json", {
					className: "Actor",
				});

				const storage = await storageOf({ routes: SPLIT });

				expect(storage.Bots).toEqual({ $path: optional("src/Bots") });
			});

			it("should copy nothing onto a node whose $path is a script, and warn with the fix", async () => {
				await write(
					"src/Combat.server.luau",
					"src/Combat/Hit.server.luau"
				);
				await writeMeta("src/Combat/init.meta.json", {
					className: "Actor",
				});

				const { tree: value, warnings } = await assemble({
					routes: SPLIT,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toEqual({
					$path: optional("src/Combat.server.luau"),
					Hit: { $path: optional("src/Combat/Hit.server.luau") },
				});
				expect(warnings).toMatchObject([
					{
						code: "meta.sharedWithScript",
						resource: abs("src/Combat/init.meta.json"),
					},
				]);
				expect(warnings[0].message).toContain("Combat.meta.json");
			});

			it("should name the init folder's own meta when a folder shares its instance with one", async () => {
				await write(
					"src/Combat/Hit.server.luau",
					"src/server/Combat/init.server.luau"
				);
				await writeMeta("src/Combat/init.meta.json", {
					className: "Actor",
				});

				const { warnings } = await assemble({ routes: SPLIT });

				expect(warnings).toMatchObject([
					{ code: "meta.sharedWithScript" },
				]);
				expect(warnings[0].message).toContain(
					`${toPosix(abs("src/server/Combat"))}/init.meta.json`
				);
				expect(warnings[0].message).not.toContain("beside the script");
			});

			it("should let the template's $id win without counting the meta's", async () => {
				await write(
					"src/Combat/server/Hit.luau",
					"src/Combat/client/Aim.luau"
				);
				await writeMeta("src/Combat/init.meta.json", { id: "combat" });
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ServerScriptService: {
							$className: "ServerScriptService",
							Combat: { $className: "Folder", $id: "server" },
						},
					},
				});

				const { tree: value } = await assemble({
					routes: SPLIT,
					template,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat").$id
				).toBe("server");
				expect(
					nodeAt(
						value.tree,
						"StarterPlayer",
						"StarterPlayerScripts",
						"Combat"
					).$id
				).toBe("combat");
			});

			it("should copy nothing from a folder whose files were all pruned", async () => {
				await write("src/Mocks/Http.mock.luau", "src/A.luau");
				await writeMeta("src/Mocks/init.meta.json", {
					className: "Actor",
				});

				const storage = await storageOf({ variants: { mock: false } });

				expect(storage.Mocks).toBeUndefined();
			});

			it("should copy nothing from a folder whose files lost their instances to a later root dir", async () => {
				await write(
					"core/Combat/server/A.luau",
					"lobby/Combat/server/A.luau"
				);
				await writeMeta("core/Combat/init.meta.json", {
					className: "Actor",
				});

				const { tree: value } = await assemble({
					rootDirs: [abs("core"), abs("lobby")],
					routes: SPLIT,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toEqual({
					...FOLDER,
					A: { $path: optional("lobby/Combat/server/A.luau") },
				});
			});

			it("should copy an id that reaches one node as $id", async () => {
				await write("src/Combat/server/Hit.luau");
				await writeMeta("src/Combat/init.meta.json", { id: "combat" });

				const { tree: value } = await assemble({ routes: SPLIT });

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toMatchObject({
					$id: "combat",
				});
			});

			it("should fail when an id reaches several nodes", async () => {
				await write(
					"src/Combat/server/Hit.luau",
					"src/Combat/client/Aim.luau"
				);
				await writeMeta("src/Combat/init.meta.json", { id: "combat" });

				const result = await assembleResult({ routes: SPLIT });

				expect(
					result.isErr() ? result.error.diagnostics : []
				).toMatchObject([
					{
						code: "meta.idOnSeveralNodes",
						resource: abs("src/Combat/init.meta.json"),
					},
				]);
			});

			it("should copy every field, letting the meta's ignoreUnknownInstances replace the container's", async () => {
				await write("src/Combat/server/Hit.luau");
				await writeMeta("src/Combat/init.meta.json", {
					$schema: "https://example.com/meta.json",
					className: "Actor",
					properties: { Archivable: false },
					attributes: { Priority: 1 },
					ignoreUnknownInstances: true,
				});

				const { tree: value } = await assemble({ routes: SPLIT });

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toEqual({
					$className: "Actor",
					$properties: { Archivable: false },
					$attributes: { Priority: 1 },
					$ignoreUnknownInstances: true,
					Hit: { $path: optional("src/Combat/server/Hit.luau") },
				});
			});

			it("should let the last root dir with a meta win each node", async () => {
				await write(
					"core/Combat/server/A.luau",
					"core/Combat/client/B.luau",
					"lobby/Combat/server/C.luau"
				);
				await writeMeta("core/Combat/init.meta.json", {
					className: "Actor",
				});
				await writeMeta("lobby/Combat/init.meta.json", {
					attributes: { Lobby: true },
				});

				const { tree: value } = await assemble({
					rootDirs: [abs("core"), abs("lobby")],
					routes: SPLIT,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toMatchObject({
					$className: "Folder",
					$attributes: { Lobby: true },
				});
				expect(
					nodeAt(
						value.tree,
						"StarterPlayer",
						"StarterPlayerScripts",
						"Combat"
					)
				).toMatchObject({ $className: "Actor" });
			});

			it("should keep an earlier root dir's meta when a later folder has none", async () => {
				await write(
					"core/Combat/server/A.luau",
					"lobby/Combat/server/C.luau"
				);
				await writeMeta("core/Combat/init.meta.json", {
					className: "Actor",
				});

				const { tree: value } = await assemble({
					rootDirs: [abs("core"), abs("lobby")],
					routes: SPLIT,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Combat")
				).toMatchObject({
					$className: "Actor",
				});
			});

			it("should fail when two metas in one root dir reach one node, naming both", async () => {
				await write(
					"src/server/Combat/A.luau",
					"src/Combat/B.server.luau"
				);
				await writeMeta("src/server/Combat/init.meta.json", {
					className: "Actor",
				});
				await writeMeta("src/Combat/init.meta.json", {
					className: "Actor",
				});

				const result = await assembleResult({ routes: SPLIT });

				const errors = result.isErr() ? result.error.diagnostics : [];
				expect(errors).toMatchObject([{ code: "meta.sameNode" }]);
				expect(errors[0].message).toContain(
					abs("src/Combat/init.meta.json")
				);
				expect(errors[0].message).toContain(
					abs("src/server/Combat/init.meta.json")
				);
			});

			it("should let the template's fields win on its container, merging properties", async () => {
				await write("src/Gui/client/Hud.luau");
				await writeMeta("src/Gui/init.meta.json", {
					className: "ScreenGui",
					properties: { Enabled: false, ResetOnSpawn: false },
					attributes: { FromMeta: true },
				});
				const template = templateOf({
					tree: {
						$className: "DataModel",
						StarterPlayer: {
							$className: "StarterPlayer",
							StarterPlayerScripts: {
								$className: "StarterPlayerScripts",
								Gui: {
									$className: "Folder",
									$properties: { Enabled: true },
									$attributes: { FromTemplate: true },
								},
							},
						},
					},
				});

				const { tree: value, warnings } = await assemble({
					routes: SPLIT,
					template,
				});

				expect(
					nodeAt(
						value.tree,
						"StarterPlayer",
						"StarterPlayerScripts",
						"Gui"
					)
				).toEqual({
					$className: "Folder",
					$properties: { Enabled: true, ResetOnSpawn: false },
					$attributes: { FromTemplate: true },
					Hud: { $path: optional("src/Gui/client/Hud.luau") },
				});
				expect(warnings).toEqual([
					{
						severity: DiagnosticSeverity.Warning,
						code: "meta.templateClass",
						resource: abs("src/Gui/init.meta.json"),
						message:
							'the template makes "StarterPlayer/StarterPlayerScripts/Gui" a Folder, so its class is kept over this meta\'s ScreenGui.',
					},
				]);
			});

			it("should not warn about a class the template and the meta agree on", async () => {
				await write("src/Gui/client/Hud.luau");
				await writeMeta("src/Gui/init.meta.json", {
					className: "ScreenGui",
				});
				const template = templateOf({
					tree: {
						$className: "DataModel",
						StarterPlayer: {
							$className: "StarterPlayer",
							StarterPlayerScripts: {
								$className: "StarterPlayerScripts",
								Gui: { $className: "ScreenGui" },
							},
						},
					},
				});

				const { warnings } = await assemble({
					routes: SPLIT,
					template,
				});

				expect(warnings).toEqual([]);
			});

			it("should leave a folder under a template $path out, meta and all", async () => {
				await write("src/Packages/server/A.luau");
				await writeMeta("src/Packages/init.meta.json", {
					className: "Actor",
				});
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ServerScriptService: {
							Packages: { $path: "Packages" },
						},
					},
				});

				const { tree: value, warnings } = await assemble({
					routes: SPLIT,
					template,
				});

				expect(
					nodeAt(value.tree, "ServerScriptService", "Packages")
				).toEqual({ $path: "Packages" });
				expect(warnings).toMatchObject([
					{
						code: "tree.templateClash",
						resource: abs("src/Packages"),
					},
					{
						code: "meta.templatePath",
						resource: abs("src/Packages/init.meta.json"),
					},
				]);
			});

			it("should still copy meta onto a template node when the template displaced a file in the folder", async () => {
				await write("src/Combat/Save.luau");
				await writeMeta("src/Combat/init.meta.json", {
					className: "Actor",
				});
				const template = templateOf({
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Combat: { Save: { $path: "hand/Save.luau" } },
						},
					},
				});

				const { tree: value } = await assemble({ template });

				expect(
					nodeAt(value.tree, "ReplicatedStorage", "Combat")
				).toEqual({
					$className: "Actor",
					Save: { $path: "hand/Save.luau" },
				});
			});

			it("should warn at each meta in a routing, variant or invisible folder or a root dir", async () => {
				await write(
					"src/Combat/server/A.luau",
					"src/Combat/dev/B.luau",
					"src/Combat/(group)/C.luau"
				);
				for (const dir of [
					"src",
					"src/Combat/server",
					"src/Combat/dev",
					"src/Combat/(group)",
				])
					await writeMeta(`${dir}/init.meta.json`, {
						className: "Actor",
					});

				const { warnings } = await assemble({
					routes: SPLIT,
					variants: { dev: true },
				});

				const nothing = (dir: string, kind: string) => ({
					code: "meta.appliesToNothing",
					resource: abs(`${dir}/init.meta.json`),
					message: `applies to nothing, because ${kind} never becomes an instance. Move the meta into the folder that should get it.`,
				});
				expect(warnings).toMatchObject([
					nothing("src/Combat/(group)", "an invisible folder"),
					nothing("src/Combat/dev", "a variant folder"),
					nothing("src/Combat/server", "a routing folder"),
					nothing("src", "a root dir"),
				]);
			});

			it("should collapse a routing folder an outer route outranks and a Name@key folder, so Rojo applies their meta", async () => {
				await write(
					"src/server/client/A.luau",
					"src/Queue@server/B.luau"
				);
				for (const dir of ["src/server/client", "src/Queue@server"])
					await writeMeta(`${dir}/init.meta.json`, {
						className: "Actor",
					});

				const { warnings, tree: value } = await assemble({
					routes: SPLIT,
				});

				expect(warnings).toEqual([]);
				expect(
					nodeAt(value.tree, "ServerScriptService", "client")
				).toEqual({ $path: optional("src/server/client") });
				expect(
					nodeAt(value.tree, "ServerScriptService", "Queue")
				).toEqual({ $path: optional("src/Queue@server") });
			});

			it("should warn about the name, not the meta, of a folder whose files were all pruned", async () => {
				await write("src/Mocks/Http.mock.luau");
				await writeMeta("src/Mocks/init.meta.json", {
					className: "Actor",
				});

				const { warnings } = await assemble({
					variants: { mock: false },
				});

				expect(warnings.map(({ code }) => code)).toEqual([
					"variant.typo",
				]);
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

				const { tree: value } = await assemble({ routes: SPLIT });

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

			it("should point a node at an init script with a variant, which Rojo reads alone, and copy its folder's meta on", async () => {
				await write(
					"src/Net/init.luau",
					"src/Net/init.mock.luau",
					"src/Net/Types.luau"
				);
				await fs.writeFile(
					abs("src/Net/init.meta.json"),
					JSON.stringify({ attributes: { Mocked: true } })
				);

				const storage = await storageOf({ variants: { mock: true } });

				expect(storage.Net).toEqual({
					$path: optional("src/Net/init.mock.luau"),
					$attributes: { Mocked: true },
					Types: { $path: optional("src/Net/Types.luau") },
				});
			});

			it("should point at the directory roblox-ts writes an index script's init into", async () => {
				await write("src/Lib/index.ts", "src/Lib/server/Api.ts");

				const { tree: value } = await assemble({
					routes: SPLIT,
					syncDir: abs("out"),
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
