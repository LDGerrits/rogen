import { toPosix } from "../../../base/path.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/config.js";
import {
	abs,
	builderOf,
	configOf,
	expectBuiltProject,
	indexOf,
} from "./fixtures.js";

describe("ConfigBuilder", () => {
	let fs: MemoryFileSystemService;

	const buildOf = async (config: ResolvedConfig) => {
		const index = await indexOf(fs, config.indexedPaths);
		return builderOf(fs, index).build(config);
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
	});

	describe("build", () => {
		it("should report the folder meta it read, and not a data file's", async () => {
			await fs.writeFile(abs("src/Combat/Hit.luau"), "");
			await fs.writeFile(abs("src/Combat/init.meta.json"), "{}");
			await fs.writeFile(abs("src/Notes.txt"), "");
			await fs.writeFile(abs("src/Notes.meta.json"), "{}");

			const result = await buildOf(configOf());

			expect(result.unwrap().readFiles).toEqual([
				abs("src/Combat/init.meta.json"),
			]);
		});

		it("should also report the meta of a script, which may set its run context", async () => {
			await fs.writeFile(abs("src/Save.server.luau"), "");
			await fs.writeFile(abs("src/Save.meta.json"), "{}");
			await fs.writeFile(abs("src/Hud.luau"), "");
			await fs.writeFile(abs("src/Hud.meta.json"), "{}");

			const result = await buildOf(configOf());

			expect(result.unwrap().readFiles).toEqual([
				abs("src/Hud.meta.json"),
				abs("src/Save.meta.json"),
			]);
		});

		it("should return a tree with no warnings when every source path exists", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const config = configOf();

			const result = await buildOf(config);

			expect(result.unwrap().findings.warnings).toEqual([]);
			expectBuiltProject(result.unwrap().projectFile);
			expect(result.unwrap().projectFile.tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					$className: "ReplicatedStorage",
					A: { $path: { optional: "src/A.luau" } },
				},
			});
		});

		it("should warn about a missing source path and still succeed", async () => {
			await fs.writeFile(abs("core/A.luau"), "");
			const config = configOf({
				sourcePaths: [abs("core"), abs("lobby")],
			});

			const result = await buildOf(config);

			expect(result.unwrap().findings.warnings).toMatchObject([
				{
					severity: DiagnosticSeverity.Warning,
					code: "scan.missingSourcePath",
					resource: abs("lobby"),
				},
			]);
		});

		it("should report unrouted files as one warning after the scan's", async () => {
			await fs.writeFile(abs("core/A.luau"), "");
			const config = configOf({
				sourcePaths: [abs("core"), abs("lobby")],
				routes: { server: "ServerScriptService" },
			});

			const result = await buildOf(config);

			expect(
				result.unwrap().findings.warnings.map((warning) => warning.code)
			).toEqual(["scan.missingSourcePath", "route.unrouted"]);
		});

		it("should emit a linked directory under its link path", async () => {
			await fs.writeFile(abs("shared/Util.luau"), "");
			await fs.createSymbolicLink(abs("shared"), abs("src/Shared"));
			const config = configOf();

			const result = await buildOf(config);

			expectBuiltProject(result.unwrap().projectFile);
			expect(result.unwrap().projectFile.tree).toEqual({
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

			expect(result.unwrap().projectFile.tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					$className: "ReplicatedStorage",
					One: { $path: { optional: "src/One" } },
					Two: { $path: { optional: "src/Two" } },
				},
			});
		});

		it("should write the name the config sets, and none otherwise", async () => {
			await fs.createDirectory(abs("src"));

			const named = await buildOf(
				configOf({ project: { name: "lobby" } })
			);
			const unnamed = await buildOf(configOf({ name: "lobby" }));

			expect(named.unwrap().projectFile.name).toBe("lobby");
			expect(unnamed.unwrap().projectFile).not.toHaveProperty("name");
		});

		it("should put the warnings of the config before the ones the build raises", async () => {
			await fs.writeFile(abs("core/A.luau"), "");
			const unknownKey = warningDiagnostic(
				"config.unknownField",
				{ resource: abs("rogen.json") },
				'"colour" is no key of a project file.'
			);

			const result = await buildOf(
				configOf({
					sourcePaths: [abs("core"), abs("lobby")],
					warnings: [unknownKey],
				})
			);

			expect(result.unwrap().findings.warnings).toMatchObject([
				unknownKey,
				{ code: "scan.missingSourcePath" },
			]);
		});

		describe("a config without routes", () => {
			const tree = {
				$className: "DataModel",
				Workspace: { $className: "Workspace" },
				ReplicatedStorage: { Vendor: { $path: "vendor" } },
			};
			const withoutRoutes = (overrides: ResolvedConfigSpec = {}) =>
				configOf({
					routes: {},
					sourcePaths: [],
					project: { tree },
					...overrides,
				});

			it("should build its tree as written and scan nothing", async () => {
				await fs.writeFile(abs("vendor/Lib.luau"), "");

				const built = (await buildOf(withoutRoutes())).unwrap();

				expectBuiltProject(built.projectFile);
				expect(built.projectFile.tree).toEqual(tree);
				expect(built.summary).toMatchObject({
					roots: [],
					routes: [],
					unrouted: 0,
				});
				expect(built.findings.warnings).toEqual([]);
			});

			it("should warn once when the default source path holds files the tree does not mount", async () => {
				await fs.writeFile(abs("src/A.luau"), "");
				await fs.writeFile(abs("src/deep/B.luau"), "");

				const built = (await buildOf(withoutRoutes())).unwrap();

				expect(built.findings.warnings).toMatchObject([
					{
						severity: DiagnosticSeverity.Warning,
						code: "scan.unmountedSource",
						resource: abs("src"),
					},
				]);
				expect(built.projectFile.tree).toEqual(tree);
			});

			it("should not warn about a config with routes", async () => {
				await fs.writeFile(abs("src/A.luau"), "");

				const built = (await buildOf(configOf())).unwrap();

				expect(built.findings.warnings).toEqual([]);
			});
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
					.findings.warnings.filter(
						({ code }) => code === "meta.unclaimed"
					);
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

			it("should count a claim from an ignored sibling", async () => {
				const warnings = await warningsFor(
					["src/Legacy.luau", "src/Legacy.meta.json"],
					{ ignored: [toPosix(abs("src/Legacy.luau"))] }
				);

				expect(warnings).toEqual([]);
			});

			const messageAt = (warnings: readonly Diagnostic[], file: string) =>
				warnings.find(({ resource }) => resource === toPosix(abs(file)))
					?.message;

			it("should warn at each meta with the name Rojo reads, the folder's meta, or that the file takes none", async () => {
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

				expect(warnings).toHaveLength(6);
				expect(messageAt(warnings, "src/Bar.meta.json")).toBe(
					"belongs to no file, so Rojo ignores it. A folder's meta is Bar/init.meta.json."
				);
				expect(messageAt(warnings, "src/Crate.meta.json")).toBe(
					"belongs to no file, so Rojo ignores it. Crate.model.json takes no meta."
				);
				expect(messageAt(warnings, "src/Foo.meta.json")).toBe(
					"belongs to no file, so Rojo ignores it. A folder's meta is Foo/init.meta.json."
				);
				expect(messageAt(warnings, "src/Nothing.meta.json")).toBe(
					"belongs to no file, so Rojo ignores it. A file's meta is named after the name Rojo gives the file, without .server, .client or .plugin."
				);
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
					{ ignored: [toPosix(abs("src/Legacy"))] }
				);

				for (const name of ["Empty", "Legacy", "Notes"])
					expect(
						messageAt(warnings, `src/${name}.meta.json`)
					).toContain(`A folder's meta is ${name}/init.meta.json.`);
			});

			it("should name the meta Rojo reads for a script's full stem", async () => {
				const warnings = await warningsFor([
					"src/Save.server.luau",
					"src/Save.server.meta.json",
				]);

				expect(
					messageAt(warnings, "src/Save.server.meta.json")
				).toContain("Rojo reads Save.meta.json.");
			});

			it("should say a model file takes no meta", async () => {
				const warnings = await warningsFor([
					"src/Tree.rbxm",
					"src/Tree.meta.json",
				]);

				expect(messageAt(warnings, "src/Tree.meta.json")).toContain(
					"Tree.rbxm takes no meta."
				);
			});
		});

		describe("summary", () => {
			it("should count each source path's files, exclusions and skipped links", async () => {
				await fs.writeFile(abs("src/A.luau"), "");
				await fs.writeFile(abs("src/B.luau"), "");
				await fs.writeFile(abs("src/Old.luau"), "");
				await fs.writeFile(abs("lib/C.luau"), "");

				const result = await buildOf(
					configOf({
						sourcePaths: [abs("src"), abs("lib")],
						ignored: [toPosix(abs("src/Old.luau"))],
					})
				);

				expect(result.unwrap().summary.roots).toEqual([
					{
						sourcePath: abs("src"),
						files: 2,
						ignored: 1,
						mounted: 0,
						skippedLinks: 0,
					},
					{
						sourcePath: abs("lib"),
						files: 1,
						ignored: 0,
						mounted: 0,
						skippedLinks: 0,
					},
				]);
			});

			it("should count each path the tree mounts that exists, once", async () => {
				await fs.writeFile(abs("src/Vendor/Lib.luau"), "");
				await fs.writeFile(abs("src/Save.luau"), "");

				const result = await buildOf(
					configOf({
						project: {
							name: "game",
							tree: {
								$className: "DataModel",
								ReplicatedStorage: {
									Vendor: { $path: "src/Vendor" },
									Gone: { $path: "src/Gone" },
								},
							},
						},
					})
				);

				expect(result.unwrap().summary.roots).toEqual([
					{
						sourcePath: abs("src"),
						files: 1,
						ignored: 0,
						mounted: 1,
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

			it("should count a copied init script once, at the route that places it", async () => {
				await fs.writeFile(abs("src/Net/init.luau"), "");
				await fs.writeFile(abs("src/Net/Util.luau"), "");
				await fs.writeFile(abs("src/Net/server/Remote.luau"), "");
				await fs.writeFile(abs("src/Net/client/Hud.luau"), "");

				const result = await buildOf(
					configOf({
						routes: {
							server: "ServerScriptService",
							client: "StarterPlayer/StarterPlayerScripts",
							"*": "ReplicatedStorage/shared",
						},
					})
				);

				expect(
					result.unwrap().summary.routes.map(({ files }) => files)
				).toEqual([1, 1, 2]);
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
				await fs.writeFile(abs("src/A.lua"), "");
				await fs.writeFile(abs("src/A.luau"), "");

				const result = await buildOf(configOf());

				expect(result.unwrap().summary.replaced).toBe(1);
			});

			it("should count a file the tree displaced, and not under its route", async () => {
				await fs.writeFile(abs("src/A.luau"), "");
				await fs.writeFile(abs("src/B.luau"), "");

				const result = await buildOf(
					configOf({
						project: {
							name: "repo",
							tree: {
								$className: "DataModel",
								ReplicatedStorage: {
									A: { $path: "A.luau" },
								},
							},
						},
					})
				);

				const { summary } = result.unwrap();
				expect(summary.displaced).toBe(1);
				expect(summary.routes).toMatchObject([{ key: "*", files: 1 }]);
			});

			it("should count a file the last source path replaced", async () => {
				await fs.writeFile(abs("src/A.luau"), "");
				await fs.writeFile(abs("lib/A.luau"), "");

				const result = await buildOf(
					configOf({ sourcePaths: [abs("src"), abs("lib")] })
				);

				expect(result.unwrap().summary.replaced).toBe(1);
			});
		});

		it("should fail on an invalid folder meta file", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			await fs.writeFile(abs("src/init.meta.json"), "[]");

			const result = await builderOf(
				fs,
				await indexOf(fs, [abs("src")])
			).build(configOf());

			expect(result.isErr() && result.error.diagnostics).toMatchObject([
				{ code: "meta.notAnObject" },
			]);
		});

		it("should check the sync path only when nothing is known of it", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const config = configOf({ syncPath: abs("dist") });
			const builder = builderOf(
				fs,
				await indexOf(fs, config.sourcePaths)
			);

			const checked = await builder.build(config);
			const known = await builder.build(config, []);

			expect(checked.unwrap().findings.syncWarnings).toMatchObject([
				{ code: "output.nothingEmitted" },
			]);
			expect(known.unwrap().findings.syncWarnings).toEqual([]);
		});
	});
});
