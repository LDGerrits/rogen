import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { expectRojoProject } from "../../rojo/__tests__/rojo-schema.js";
import { build, checkRoutes, rootsToIndex } from "../build.js";
import { readFolderMeta } from "../read-folder-meta.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

const configOf = (overrides: Partial<ResolvedConfig> = {}): ResolvedConfig => ({
	name: "repo",
	rootDirs: [abs("src")],
	routes: { "*": "ReplicatedStorage" },
	tags: {},
	exclude: [],
	outFile: abs("default.project.json"),
	...overrides,
});

describe("domain/build/build", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const indexOf = async (rootDirs: readonly string[]) => {
		const index = store.add(new CoreIndexService(fs));
		await index.initialize([...rootDirs]);
		return index;
	};

	const buildOf = async (config: ResolvedConfig) => {
		const index = await indexOf(config.rootDirs);
		return build(
			config,
			index,
			(await readFolderMeta(fs, index, config)).unwrap()
		);
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("build", () => {
		it("should return a tree with no warnings when every root dir exists", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const config = configOf();

			const result = await buildOf(config);

			expect(result.unwrap().warnings).toEqual([]);
			expectRojoProject(result.unwrap().value);
			expect(result.unwrap().value.tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					$className: "ReplicatedStorage",
					A: { $path: { optional: "src/A.luau" } },
				},
			});
		});

		it("should return the tag stage's warnings", async () => {
			await fs.writeFile(abs("src/HttpMock.luau"), "");
			const config = configOf({ tags: { mock: false } });

			const result = await buildOf(config);

			expect(result.unwrap().warnings).toMatchObject([
				{ code: "tag.dormantCapitalSuffix" },
			]);
		});

		it("should fail when two active tags claim one instance", async () => {
			await fs.writeFile(abs("src/A.mock.luau"), "");
			await fs.writeFile(abs("src/A.dev.luau"), "");
			const config = configOf({ tags: { mock: true, dev: true } });

			const result = await buildOf(config);

			expect(result.isErr() ? result.error : []).toMatchObject([
				{ code: "tag.activeClash" },
			]);
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
				routes: {},
			});

			const result = await buildOf(config);

			expect(
				result.unwrap().warnings.map((warning) => warning.code)
			).toEqual(["scan.missingRootDir", "route.unrouted"]);
		});

		it("should fail when a route targets an unsupported service", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const config = configOf({ routes: { "*": "Nowhere" } });

			const result = await buildOf(config);

			expect(result.isErr() ? result.error : []).toMatchObject([
				{ code: "roblox.unsupportedService" },
			]);
		});

		it("should emit a linked directory under its link path", async () => {
			await fs.writeFile(abs("shared/Util.luau"), "");
			await fs.createSymbolicLink(abs("shared"), abs("src/Shared"));
			const config = configOf();

			const result = await buildOf(config);

			expectRojoProject(result.unwrap().value);
			expect(result.unwrap().value.tree).toEqual({
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

			expect(result.unwrap().value.tree).toEqual({
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

			expectRojoProject(result.unwrap().value);
			expect(result.unwrap().value.name).toBe("lobby");
		});

		describe("unclaimed meta", () => {
			const warningsFor = async (
				files: readonly string[],
				overrides: Partial<ResolvedConfig> = {}
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

			it("should count unrouted files and files another replaced", async () => {
				await fs.writeFile(abs("src/A.luau"), "");
				await fs.writeFile(abs("src/A.mock.luau"), "");
				await fs.writeFile(abs("src/B.client.luau"), "");

				const result = await buildOf(
					configOf({
						routes: { server: "ServerScriptService" },
						tags: { mock: true },
					})
				);
				const { unrouted, superseded } = result.unwrap().summary;

				expect({ unrouted, superseded }).toEqual({
					unrouted: 3,
					superseded: 0,
				});

				const routed = await buildOf(
					configOf({ tags: { mock: true } })
				);

				expect(routed.unwrap().summary.superseded).toBe(1);
			});
		});
	});

	describe("checkRoutes", () => {
		it("should name each config file that declares no routes", () => {
			const diagnostics = checkRoutes([
				{
					file: abs("default.rogen.json"),
					routes: { "*": "Workspace" },
				},
				{ file: abs("bare.rogen.json"), routes: {} },
			]);

			expect(diagnostics).toMatchObject([
				{ code: "route.noRoutes", resource: abs("bare.rogen.json") },
			]);
		});

		it("should report nothing when every config declares a route", () => {
			expect(
				checkRoutes([
					{
						file: abs("a.rogen.json"),
						routes: { server: "Workspace" },
					},
				])
			).toEqual([]);
		});
	});

	describe("rootsToIndex", () => {
		it("should drop a dir that lies inside another config's dir", () => {
			expect(
				rootsToIndex([
					{ rootDirs: [abs("src")] },
					{ rootDirs: [abs("src"), abs("src/shared")] },
				])
			).toEqual([abs("src")]);
		});

		it("should keep dirs that only share a name prefix", () => {
			expect(
				rootsToIndex([{ rootDirs: [abs("src"), abs("src-extra")] }])
			).toEqual([abs("src"), abs("src-extra")]);
		});

		it("should drop a nested dir even when it comes first", () => {
			expect(
				rootsToIndex([{ rootDirs: [abs("src/shared"), abs("src")] }])
			).toEqual([abs("src")]);
		});

		it("should resolve relative dirs to absolute ones", () => {
			expect(rootsToIndex([{ rootDirs: ["src"] }])).toEqual([
				path.resolve("src"),
			]);
		});

		it("should return nothing for no configs", () => {
			expect(rootsToIndex([])).toEqual([]);
		});
	});
});
