import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { expectRojoProject } from "../../rojo/__tests__/rojo-schema.js";
import { RojoNode, RojoTree } from "../../rojo/rojo-tree.js";
import { build } from "../build.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

const FOLDER = { $className: "Folder", $ignoreUnknownInstances: false };

const optional = (target: string) => ({ optional: target });

describe("assembleTree", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const write = async (...paths: string[]) => {
		for (const p of paths) await fs.writeFile(abs(p), "");
	};

	const assemble = async (overrides: Partial<ResolvedConfig> = {}) => {
		const config: ResolvedConfig = {
			name: "repo",
			rootDirs: [abs("src")],
			routes: { "*": "ReplicatedStorage" },
			tags: {},
			exclude: [],
			outFile: abs("default.project.json"),
			...overrides,
		};
		const index = store.add(new CoreIndexService(fs));
		await index.initialize([...config.rootDirs]);
		const output = build(config, index).unwrap();
		expectRojoProject(output.value);
		return output;
	};

	const storageOf = async (overrides: Partial<ResolvedConfig> = {}) =>
		(await assemble(overrides)).value.tree.ReplicatedStorage as RojoNode;

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
			const { value } = await assemble({ name: "game" });

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

			const { value } = await assemble({ name: "game", template });

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

			expect(storage.Packages).toEqual({ $path: "templates/Packages" });
			expect(storage.Vendor).toEqual({
				$path: optional("templates/vendor"),
			});
		});

		it("should leave a template $path as written when the template sits beside the output", async () => {
			const template = templateOf({
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "./Packages" } },
				},
			});

			const storage = await storageOf({ template });

			expect(storage.Packages).toEqual({ $path: "./Packages" });
		});

		it("should keep the template's node and warn when a generated instance clashes", async () => {
			await write("src/Packages/A.luau", "src/Packages/B.luau");
			const template = templateOf({
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "Packages" } },
				},
			});

			const { value, warnings } = await assemble({ template });

			expect((value.tree.ReplicatedStorage as RojoNode).Packages).toEqual(
				{ $path: "Packages" }
			);
			expect(warnings).toMatchObject([{ code: "tree.templateClash" }]);
			expect(warnings[0].message).toContain("ReplicatedStorage/Packages");
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

			const { value } = await assemble({
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

			const { value } = await assemble({
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
				...(emitLegacyScripts !== undefined && { emitLegacyScripts }),
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
				{ client: "ReplicatedStorage/client", server: "StarterGui" },
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

			const { value } = await assemble({
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
			await write("src/Inventory/Save.luau", "src/Inventory/Items.json");

			const { value, warnings } = await assemble();

			expect(warnings).toEqual([]);
			expect(
				(value.tree.ReplicatedStorage as RojoNode).Inventory
			).toEqual({ $path: optional("src/Inventory") });
		});

		it("should collapse an invisible folder onto the instance it stands for", async () => {
			await write("src/Inventory/(group)/Save.luau");

			const storage = await storageOf();

			expect(storage.Inventory).toEqual({
				$path: optional("src/Inventory/(group)"),
			});
		});

		it("should not collapse a directory with a dormant-tag file", async () => {
			await write(
				"src/Inventory/Analytics.luau",
				"src/Inventory/Analytics.mock.luau"
			);

			const storage = await storageOf({ tags: { mock: false } });

			expect(storage.Inventory).toEqual({
				...FOLDER,
				Analytics: { $path: optional("src/Inventory/Analytics.luau") },
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

			const { value } = await assemble({
				routes: { client: "StarterPlayer/StarterPlayerScripts" },
			});

			expect(value.tree.StarterPlayer).toEqual({
				$className: "StarterPlayer",
				StarterPlayerScripts: {
					$className: "StarterPlayerScripts",
					Inventory: {
						...FOLDER,
						Hud: {
							$path: optional("src/Inventory/Hud.client.luau"),
						},
					},
				},
			});
		});

		it("should not collapse a directory holding a file that lost its instance to another root", async () => {
			await write("core/Inventory/Save.luau", "core/Inventory/Load.luau");
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
				Load: { $path: optional("src/(group)/Inventory/Load.luau") },
			});
		});

		it("should not collapse a directory holding a file Rojo would name differently, and emit it under its instance name", async () => {
			await write("src/Save/Save+mock.server.luau");

			const { value } = await assemble({
				tags: { mock: true },
				routes: { server: "ServerScriptService" },
			});

			expect(value.tree.ServerScriptService).toEqual({
				$className: "ServerScriptService",
				Save: {
					...FOLDER,
					Save: { $path: optional("src/Save/Save+mock.server.luau") },
				},
			});
		});

		it("should not collapse a directory holding the file an active tag replaced", async () => {
			await write(
				"src/Inventory/Analytics.luau",
				"src/Inventory/Analytics.mock.luau"
			);

			const storage = await storageOf({ tags: { mock: true } });

			expect(storage.Inventory).toEqual({
				...FOLDER,
				Analytics: {
					$path: optional("src/Inventory/Analytics.mock.luau"),
				},
			});
		});

		it("should not collapse a directory whose file has a route suffix other than .server or .client", async () => {
			await write("src/Types/Types.shared.luau");

			const storage = await storageOf({
				routes: { shared: "ReplicatedStorage" },
			});

			expect(storage.Types).toEqual({
				...FOLDER,
				Types: { $path: optional("src/Types/Types.shared.luau") },
			});
		});

		it("should never collapse a directory into a service", async () => {
			await write("src/server/Save.luau");

			const { value } = await assemble({
				routes: { server: "ServerScriptService" },
			});

			expect(value.tree.ServerScriptService).toEqual({
				$className: "ServerScriptService",
				Save: { $path: optional("src/server/Save.luau") },
			});
		});

		it("should emit an init folder as one node pointing at the directory", async () => {
			await write("src/Inventory/init.luau", "src/Inventory/Save.luau");
			await write("src/Other.luau");

			const storage = await storageOf();

			expect(storage).toMatchObject({
				Inventory: { $path: optional("src/Inventory") },
				Other: { $path: optional("src/Other.luau") },
			});
		});

		it("should ignore .d.ts files when deciding to collapse and never list them", async () => {
			await write("src/Inventory/Save.ts", "src/Inventory/Save.d.ts");

			const { value } = await assemble({
				exclude: [abs("**/*.d.ts")],
			});

			expect(
				(value.tree.ReplicatedStorage as RojoNode).Inventory
			).toEqual({ $path: optional("src/Inventory") });
			expect(value.globIgnorePaths).toBeUndefined();
		});
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

			const { value, warnings } = await assemble({ template });

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

			expect(storage.Packages).toEqual({ $path: optional("Packages") });
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

			const { value, warnings } = await assemble();

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
				Outer: { $path: optional("src/Inventory/Outer.project.json") },
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

			const { value } = await assemble({
				syncDir: abs("dist"),
				tags: { mock: false },
			});

			expect(value.globIgnorePaths).toEqual([
				"dist/Inventory/Analytics.mock.luau",
			]);
		});

		it("should list excluded and pruned files, translated to sync paths", async () => {
			await write(
				"src/Inventory/Analytics.luau",
				"src/Inventory/Analytics.mock.luau",
				"src/Inventory/Save.spec.ts"
			);

			const { value } = await assemble({
				syncDir: abs("dist"),
				tags: { mock: false },
				exclude: [abs("**/*.spec.ts")],
			});

			expect(value.globIgnorePaths).toEqual([
				"dist/Inventory/Save.spec.luau",
				"dist/Inventory/Analytics.mock.luau",
			]);
		});

		it("should list an unrouted file", async () => {
			await write("src/Hud.ts", "src/Combat.server.ts");

			const { value } = await assemble({
				syncDir: abs("dist"),
				routes: { server: "ServerScriptService" },
			});

			expect(value.globIgnorePaths).toEqual(["dist/Hud.luau"]);
		});

		it("should union the template's rebased globs without duplicates", async () => {
			await write("src/Foo.luau", "src/Foo.spec.luau");
			const template = templateOf(
				{
					tree: { $className: "DataModel" },
					globIgnorePaths: ["**/*.spec.luau", "../src/Foo.spec.luau"],
				},
				abs("templates/base.project.json")
			);

			const { value } = await assemble({
				template,
				exclude: [abs("src/Foo.spec.luau")],
			});

			expect(value.globIgnorePaths).toEqual([
				"templates/**/*.spec.luau",
				"src/Foo.spec.luau",
			]);
		});
	});
});
