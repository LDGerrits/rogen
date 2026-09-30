import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { InstanceReference } from "../../roblox/roblox.js";
import { expectRojoProject } from "../../rojo/__tests__/rojo-schema.js";
import { abs, buildServiceOf, configOf, indexOf } from "./fixtures.js";

describe("CoreBuildService", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const buildServiceOfFs = () =>
		buildServiceOf(fs, store.add(new CoreIndexService(fs)));

	const buildOf = async (config: ResolvedConfig) => {
		const index = await indexOf(store, fs, config.rootDirs);
		return buildServiceOf(fs, index).build(config);
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("build", () => {
		it("should fail when the config declares no routes, without reading the index", async () => {
			const config = configOf({ routes: {} });

			const result = await buildServiceOfFs().build(config);

			expect(
				result.isErr() ? result.error.diagnostics : []
			).toMatchObject([
				{ code: "route.noRoutes", resource: abs("default.rogen.json") },
			]);
		});

		it("should name the file it would write", async () => {
			const result = await buildOf(
				configOf({ outFile: abs("out/game.project.json") })
			);

			expect(result.unwrap().outFile).toBe(abs("out/game.project.json"));
		});

		it("should report the folder meta it read, and only that", async () => {
			await fs.writeFile(abs("src/Combat/Hit.luau"), "");
			await fs.writeFile(abs("src/Combat/init.meta.json"), "{}");
			await fs.writeFile(abs("src/Hud.luau"), "");
			await fs.writeFile(abs("src/Hud.meta.json"), "{}");

			const result = await buildOf(configOf());

			expect(result.unwrap().readFiles).toEqual([
				abs("src/Combat/init.meta.json"),
			]);
		});

		it("should return a tree with no warnings when every root dir exists", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const config = configOf();

			const result = await buildOf(config);

			expect(result.unwrap().warnings).toEqual([]);
			expectRojoProject(result.unwrap().tree);
			expect(result.unwrap().tree.tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					$className: "ReplicatedStorage",
					A: { $path: { optional: "src/A.luau" } },
				},
			});
		});

		it("should return the tag stage's warnings", async () => {
			await fs.writeFile(abs("src/Save.server.mock.luau"), "");
			const config = configOf({ tags: { mock: true } });

			const result = await buildOf(config);

			expect(result.unwrap().warnings).toMatchObject([
				{ code: "tag.buriedScriptSuffix" },
			]);
		});

		it("should fail when two active tags claim one instance", async () => {
			await fs.writeFile(abs("src/A.mock.luau"), "");
			await fs.writeFile(abs("src/A.dev.luau"), "");
			const config = configOf({ tags: { mock: true, dev: true } });

			const result = await buildOf(config);

			expect(
				result.isErr() ? result.error.diagnostics : []
			).toMatchObject([{ code: "tag.activeClash" }]);
		});

		it("should warn about a missing root dir and still succeed", async () => {
			await fs.writeFile(abs("core/A.luau"), "");
			const config = configOf({ rootDirs: [abs("core"), abs("lobby")] });

			const result = await buildOf(config);

			expect(result.unwrap().warnings).toMatchObject([
				{
					severity: DiagnosticSeverity.Warning,
					code: "scan.missingRootDir",
					resource: abs("lobby"),
				},
			]);
		});

		it("should report unrouted files as one warning after the scan's", async () => {
			await fs.writeFile(abs("core/A.luau"), "");
			const config = configOf({
				rootDirs: [abs("core"), abs("lobby")],
				routes: { server: "ServerScriptService" },
			});

			const result = await buildOf(config);

			expect(
				result.unwrap().warnings.map((warning) => warning.code)
			).toEqual(["scan.missingRootDir", "route.unrouted"]);
		});

		it("should emit a linked directory under its link path", async () => {
			await fs.writeFile(abs("shared/Util.luau"), "");
			await fs.createSymbolicLink(abs("shared"), abs("src/Shared"));
			const config = configOf();

			const result = await buildOf(config);

			expectRojoProject(result.unwrap().tree);
			expect(result.unwrap().tree.tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					$className: "ReplicatedStorage",
					Shared: { $path: { optional: "src/Shared" } },
				},
			});
		});

		it("should emit two links to one target as two instances", async () => {
			await fs.writeFile(abs("shared/Util.luau"), "");
			await fs.createSymbolicLink(abs("shared"), abs("src/One"));
			await fs.createSymbolicLink(abs("shared"), abs("src/Two"));
			const config = configOf();

			const result = await buildOf(config);

			expect(result.unwrap().tree.tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					$className: "ReplicatedStorage",
					One: { $path: { optional: "src/One" } },
					Two: { $path: { optional: "src/Two" } },
				},
			});
		});

		it("should name the project after the config's resolved name", async () => {
			await fs.createDirectory(abs("src"));
			const config = configOf({ name: "lobby" });

			const result = await buildOf(config);

			expectRojoProject(result.unwrap().tree);
			expect(result.unwrap().tree.name).toBe("lobby");
		});

		describe("unclaimed meta", () => {
			const warningsFor = async (
				files: readonly string[],
				overrides: ResolvedConfigSpec = {}
			) => {
				for (const file of files)
					await fs.writeFile(
						abs(file),
						file.endsWith(".meta.json") ? "{}" : ""
					);
				const config = configOf(overrides);
				return (await buildOf(config))
					.unwrap()
					.warnings.filter(({ code }) => code === "meta.unclaimed");
			};

			it("should not warn about meta that a sibling claims under the name Rojo gives it", async () => {
				const warnings = await warningsFor(
					[
						"src/Plain.luau",
						"src/Plain.meta.json",
						"src/Save.server.luau",
						"src/Save.meta.json",
						"src/Foo.mock.server.luau",
						"src/Foo.mock.meta.json",
						"src/Combat@server.luau",
						"src/Combat@server.meta.json",
						"src/Hud.client.ts",
						"src/Hud.meta.json",
						"src/Tool.plugin.lua",
						"src/Tool.meta.json",
						"src/Items.csv",
						"src/Items.meta.json",
						"src/Stats.server.json",
						"src/Stats.server.meta.json",
						"src/Bots/init.meta.json",
						"src/Bots/A.luau",
					],
					{
						routes: {
							server: "ServerScriptService",
							"*": "ReplicatedStorage",
						},
					}
				);

				expect(warnings).toEqual([]);
			});

			it("should read .model and .project as part of the name outside .json files", async () => {
				const warnings = await warningsFor([
					"src/Cfg.model.toml",
					"src/Cfg.model.meta.json",
					"src/Notes.project.txt",
					"src/Notes.project.meta.json",
				]);

				expect(warnings).toEqual([]);
			});

			it("should count a claim from a pruned or excluded sibling", async () => {
				const warnings = await warningsFor(
					[
						"src/Analytics.mock.luau",
						"src/Analytics.mock.meta.json",
						"src/Legacy.luau",
						"src/Legacy.meta.json",
					],
					{
						tags: { mock: false },
						exclude: [toPosix(abs("src/Legacy.luau"))],
					}
				);

				expect(warnings).toEqual([]);
			});

			it("should warn once with the name Rojo reads, the folder's meta, or that the file takes none", async () => {
				const warnings = await warningsFor([
					"src/Save.server.luau",
					"src/Save.server.meta.json",
					"src/Foo/A.luau",
					"src/Foo.meta.json",
					"src/Bar/init.luau",
					"src/Bar.meta.json",
					"src/Crate.model.json",
					"src/Crate.meta.json",
					"src/Tree.rbxm",
					"src/Tree.meta.json",
					"src/Nothing.meta.json",
				]);

				expect(warnings).toHaveLength(1);
				expect(warnings[0].resource).toBe(abs("default.project.json"));
				expect(warnings[0].message).toMatch(
					/^6 meta files belong to no file/
				);
				for (const entry of [
					`${toPosix(abs("src/Bar.meta.json"))} (a folder's meta is Bar/init.meta.json)`,
					`${toPosix(abs("src/Crate.meta.json"))} (Crate.model.json takes no meta)`,
					`${toPosix(abs("src/Foo.meta.json"))} (a folder's meta is Foo/init.meta.json)`,
				])
					expect(warnings[0].message).toContain(entry);
			});

			it("should give the folder hint for a folder holding no file Rogen places", async () => {
				await fs.createDirectory(abs("src/Empty"));
				const warnings = await warningsFor(
					[
						"src/Notes/readme.md",
						"src/Notes.meta.json",
						"src/Legacy/A.luau",
						"src/Legacy.meta.json",
						"src/Empty.meta.json",
					],
					{ exclude: [toPosix(abs("src/Legacy"))] }
				);

				for (const name of ["Empty", "Legacy", "Notes"])
					expect(warnings[0].message).toContain(
						`${toPosix(abs(`src/${name}.meta.json`))} (a folder's meta is ${name}/init.meta.json)`
					);
			});

			it("should name the meta Rojo reads for a script's full stem", async () => {
				const warnings = await warningsFor([
					"src/Save.server.luau",
					"src/Save.server.meta.json",
				]);

				expect(warnings[0].message).toContain(
					`${toPosix(abs("src/Save.server.meta.json"))} (Rojo reads Save.meta.json)`
				);
			});

			it("should say a model file takes no meta", async () => {
				const warnings = await warningsFor([
					"src/Tree.rbxm",
					"src/Tree.meta.json",
				]);

				expect(warnings[0].message).toContain(
					`${toPosix(abs("src/Tree.meta.json"))} (Tree.rbxm takes no meta)`
				);
			});
		});

		describe("summary", () => {
			it("should count each root dir's files, exclusions and skipped links", async () => {
				await fs.writeFile(abs("src/A.luau"), "");
				await fs.writeFile(abs("src/B.luau"), "");
				await fs.writeFile(abs("src/Old.luau"), "");
				await fs.writeFile(abs("lib/C.luau"), "");

				const result = await buildOf(
					configOf({
						rootDirs: [abs("src"), abs("lib")],
						exclude: [toPosix(abs("src/Old.luau"))],
					})
				);

				expect(result.unwrap().summary.roots).toEqual([
					{
						rootDir: abs("src"),
						files: 2,
						excluded: 1,
						skippedLinks: 0,
					},
					{
						rootDir: abs("lib"),
						files: 1,
						excluded: 0,
						skippedLinks: 0,
					},
				]);
			});

			it("should count the files each route places, in declared order", async () => {
				await fs.writeFile(abs("src/A.server.luau"), "");
				await fs.writeFile(abs("src/B.luau"), "");
				await fs.writeFile(abs("src/C.luau"), "");

				const result = await buildOf(
					configOf({
						routes: {
							server: "ServerScriptService",
							client: "StarterPlayer/StarterPlayerScripts",
							"*": "ReplicatedStorage/shared",
						},
					})
				);

				expect(result.unwrap().summary.routes).toEqual([
					{ key: "server", target: "ServerScriptService", files: 1 },
					{
						key: "client",
						target: "StarterPlayer/StarterPlayerScripts",
						files: 0,
					},
					{ key: "*", target: "ReplicatedStorage/shared", files: 2 },
				]);
			});

			it("should count the files each tag marks, whether on or off", async () => {
				await fs.writeFile(abs("src/A.mock.luau"), "");
				await fs.writeFile(abs("src/debug/B.luau"), "");
				await fs.writeFile(abs("src/debug/C.luau"), "");

				const result = await buildOf(
					configOf({ tags: { mock: true, debug: false } })
				);

				expect(result.unwrap().summary.tags).toEqual([
					{ tag: "mock", on: true, files: 1 },
					{ tag: "debug", on: false, files: 2 },
				]);
			});

			it("should count only placed files for a tag that's on", async () => {
				await fs.writeFile(abs("src/A.mock.luau"), "");
				await fs.writeFile(abs("src/B.mock.debug.luau"), "");

				const result = await buildOf(
					configOf({ tags: { mock: true, debug: false } })
				);

				expect(result.unwrap().summary.tags).toEqual([
					{ tag: "mock", on: true, files: 1 },
					{ tag: "debug", on: false, files: 1 },
				]);
			});

			it("should count the files no route governs", async () => {
				await fs.writeFile(abs("src/A.luau"), "");
				await fs.writeFile(abs("src/B.client.luau"), "");

				const result = await buildOf(
					configOf({ routes: { server: "ServerScriptService" } })
				);

				expect(result.unwrap().summary.unrouted).toBe(2);
			});

			it("should count the files another with the same name replaced", async () => {
				await fs.writeFile(abs("src/A.luau"), "");
				await fs.writeFile(abs("src/A.mock.luau"), "");

				const result = await buildOf(
					configOf({ tags: { mock: true } })
				);

				expect(result.unwrap().summary.superseded).toBe(1);
			});

			it("should count a file the template displaced, and not under its route", async () => {
				await fs.writeFile(abs("src/A.luau"), "");
				await fs.writeFile(abs("src/B.luau"), "");

				const result = await buildOf(
					configOf({
						template: {
							file: abs("default.project.json"),
							project: {
								name: "repo",
								tree: {
									$className: "DataModel",
									ReplicatedStorage: {
										A: { $path: "A.luau" },
									},
								},
							},
						},
					})
				);

				const { summary } = result.unwrap();
				expect(summary.displaced).toBe(1);
				expect(summary.routes).toMatchObject([{ key: "*", files: 1 }]);
			});

			it("should count a file the last root dir replaced", async () => {
				await fs.writeFile(abs("src/A.luau"), "");
				await fs.writeFile(abs("lib/A.luau"), "");

				const result = await buildOf(
					configOf({ rootDirs: [abs("src"), abs("lib")] })
				);

				expect(result.unwrap().summary.superseded).toBe(1);
			});
		});

		it("should refuse a config that declares no routes before scanning", async () => {
			const result = await buildServiceOf(
				fs,
				await indexOf(store, fs, [])
			).build(configOf({ routes: {} }));

			expect(result.isErr() && result.error.diagnostics).toMatchObject([
				{ code: "route.noRoutes", resource: abs("default.rogen.json") },
			]);
		});

		it("should fail on an invalid folder meta file", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			await fs.writeFile(abs("src/init.meta.json"), "[]");

			const result = await buildServiceOf(
				fs,
				await indexOf(store, fs, [abs("src")])
			).build(configOf());

			expect(result.isErr() && result.error.diagnostics).toMatchObject([
				{ code: "meta.notAnObject" },
			]);
		});

		it("should index the root dirs it reads itself", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const result = await buildServiceOfFs().build(configOf());

			expect(result.unwrap().summary.roots).toMatchObject([
				{ rootDir: abs("src"), files: 1 },
			]);
		});

		it("should check the sync dir only when asked", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const config = configOf({ syncDir: abs("dist") });
			const buildService = buildServiceOf(
				fs,
				await indexOf(store, fs, config.rootDirs)
			);

			const unchecked = await buildService.build(config);
			const checked = await buildService.build(config, {
				checkSyncDir: true,
			});

			expect(unchecked.unwrap().syncWarnings).toEqual([]);
			expect(checked.unwrap().syncWarnings).toMatchObject([
				{ code: "output.nothingEmitted" },
			]);
		});
	});

	describe("locate", () => {
		it("should fail when the config declares no routes", async () => {
			const result = await buildServiceOfFs().locate(
				configOf({ routes: {} })
			);

			expect(
				result.isErr() ? result.error.diagnostics : []
			).toMatchObject([{ code: "route.noRoutes" }]);
		});
	});

	describe("locateInstances", () => {
		const routes = {
			server: "ServerScriptService",
			"*": "ReplicatedStorage/Shared",
		};

		it("should find the files placed at an instance and inside it", async () => {
			await fs.writeFile(abs("src/Inventory/server/Save.luau"), "");
			await fs.writeFile(abs("src/Inventory/server/Load.luau"), "");
			await fs.writeFile(abs("src/Inventory/Types.luau"), "");
			const reference = InstanceReference.parse(
				"ServerScriptService.Inventory"
			)!;

			const result = await buildServiceOfFs().locateInstances(
				configOf({ routes }),
				[reference]
			);

			expect(
				result.unwrap()[0].files.map(({ source }) => source)
			).toEqual([
				toPosix(abs("src/Inventory/server/Load.luau")),
				toPosix(abs("src/Inventory/server/Save.luau")),
			]);
		});

		it("should find no file for an instance nothing places", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const reference = InstanceReference.parse(
				"ServerScriptService.Missing:3"
			)!;

			const result = await buildServiceOfFs().locateInstances(
				configOf({ routes }),
				[reference]
			);

			expect(result.unwrap()).toEqual([{ reference, files: [] }]);
		});
	});

	describe("checkBuildable", () => {
		const check = (...configs: ResolvedConfig[]) =>
			buildServiceOfFs().checkBuildable(configs);
		const diagnosticsOf = (result: ReturnType<typeof check>) => {
			if (result.isOk()) throw new Error("Expected the check to fail.");
			return result.error.diagnostics;
		};

		it("should name each config file that declares no routes", () => {
			const result = check(
				configOf({ routes: { "*": "Workspace" } }),
				configOf({
					file: abs("bare.rogen.json"),
					outFile: abs("bare.project.json"),
					routes: {},
				})
			);

			expect(diagnosticsOf(result)).toMatchObject([
				{ code: "route.noRoutes", resource: abs("bare.rogen.json") },
			]);
		});

		it("should refuse two configs that write one file", () => {
			const result = check(
				configOf(),
				configOf({ file: abs("other.rogen.json") })
			);

			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "output.sameOutFile",
					resource: abs("default.project.json"),
				},
			]);
		});

		it("should pass configs that can all be built", () => {
			expect(check(configOf()).isOk()).toBe(true);
		});
	});
});
