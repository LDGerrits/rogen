import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	MockConfigSelection,
	ResolvedConfigSpec,
	selectionOf,
	brokenEntry,
	mockEntry,
} from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { BuildSet, LoadedBuild } from "../build.js";
import { ConfigEntry } from "../../config/config-service.js";
import { abs, buildServiceOf, configOf, locateIn } from "./fixtures.js";

describe("CoreBuildService", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const buildServiceOfFs = () => buildServiceOf(fs, new CoreIndexService(fs));

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("build", () => {
		const lobby = (spec: ResolvedConfigSpec = {}) =>
			configOf({
				file: abs("lobby.rogen.json"),
				outFile: abs("lobby.project.json"),
				rootDirs: [abs("lobby")],
				...spec,
			});

		const runOf = async (configs: readonly ResolvedConfig[]) => {
			return (await buildServiceOfFs().build(selectionOf(...configs)))
				.builds;
		};

		const loadable = (file: string, spec: ResolvedConfigSpec = {}) =>
			mockEntry(
				{
					rootDirs: [abs("src")],
					routes: { "*": "ReplicatedStorage" },
					outFile: abs(
						`${path.basename(file, ".rogen.json")}.project.json`
					),
					...spec,
				},
				file
			);

		const outcomesOf = (builds: Awaited<ReturnType<typeof runOf>>) =>
			builds.map((build) => [
				build.outcome === "notLoaded" ? build.file : build.config.file,
				build.outcome,
			]);

		beforeEach(async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			await fs.writeFile(abs("lobby/B.luau"), "");
		});

		it("should index the root dirs it reads itself", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const [build] = (
				await buildServiceOfFs().build(selectionOf(configOf()))
			).builds;

			expect(build).toMatchObject({
				summary: { roots: [{ rootDir: abs("src"), files: 1 }] },
			});
		});

		it("should write every config's project file and say what each did", async () => {
			const result = await runOf([configOf(), lobby()]);

			expect(outcomesOf(result)).toEqual([
				[abs("default.rogen.json"), "wrote"],
				[abs("lobby.rogen.json"), "wrote"],
			]);
			expect(result).toMatchObject([
				{ summary: { roots: [{ files: 1 }] } },
				{ summary: { roots: [{ files: 1 }] } },
			]);
			expect(await fs.exists(abs("lobby.project.json"))).toBe(true);
		});

		it("should say unchanged for a project file that is up to date", async () => {
			const configs = [configOf(), lobby()];
			await runOf(configs);

			const result = await runOf(configs);

			expect(result.map(({ outcome }) => outcome)).toEqual([
				"unchanged",
				"unchanged",
			]);
		});

		it("should write nothing when any config fails to build", async () => {
			await fs.writeFile(abs("lobby/init.meta.json"), "{ nope");

			const result = await runOf([configOf(), lobby()]);

			expect(outcomesOf(result)).toEqual([
				[abs("default.rogen.json"), "notWritten"],
				[abs("lobby.rogen.json"), "failed"],
			]);
			expect(result[1]).toMatchObject({
				errors: expect.arrayContaining([
					expect.objectContaining({ code: "meta.invalidSyntax" }),
				]),
			});
			expect(result[0]).toMatchObject({ blockedBy: [result[1].label] });
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});

		it("should report a config that doesn't load beside the ones that do, and write nothing", async () => {
			const result = (
				await buildServiceOfFs().build(
					new MockConfigSelection([
						loadable(abs("default.rogen.json")),
						brokenEntry(
							[
								errorDiagnostic(
									"config.invalidSyntax",
									{ resource: abs("broken.rogen.json") },
									"invalid JSONC: expected '}'."
								),
							],
							abs("broken.rogen.json")
						),
					])
				)
			).builds;

			expect(outcomesOf(result)).toEqual([
				[abs("default.rogen.json"), "notWritten"],
				[abs("broken.rogen.json"), "notLoaded"],
			]);
			expect(result[0]).toMatchObject({ blockedBy: ["broken"] });
			expect(result[1]).toMatchObject({
				label: "broken",
				errors: [{ code: "config.invalidSyntax" }],
			});
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});

		it("should keep the selection order when a config that doesn't load comes first", async () => {
			const result = (
				await buildServiceOfFs().build(
					new MockConfigSelection([
						brokenEntry([], abs("a.rogen.json")),
						loadable(abs("default.rogen.json")),
					])
				)
			).builds;

			expect(result.map(({ label }) => label)).toEqual(["a", "default"]);
		});

		it("should block every other config on each one that fails or doesn't load", async () => {
			await fs.writeFile(abs("lobby/init.meta.json"), "{ nope");

			const result = (
				await buildServiceOfFs().build(
					new MockConfigSelection([
						loadable(abs("default.rogen.json")),
						brokenEntry([], abs("broken.rogen.json")),
						loadable(abs("lobby.rogen.json"), {
							rootDirs: [abs("lobby")],
						}),
					])
				)
			).builds;

			expect(result[0]).toMatchObject({
				blockedBy: ["broken", "lobby"],
			});
		});

		it("should stop at the first config that cannot be written", async () => {
			await fs.createDirectory(abs("lobby.project.json"));
			await fs.writeFile(abs("arena/C.luau"), "");

			const result = await runOf([
				configOf(),
				lobby(),
				lobby({
					file: abs("arena.rogen.json"),
					outFile: abs("arena.project.json"),
					rootDirs: [abs("arena")],
				}),
			]);

			expect(outcomesOf(result)).toEqual([
				[abs("default.rogen.json"), "wrote"],
				[abs("lobby.rogen.json"), "failed"],
				[abs("arena.rogen.json"), "notWritten"],
			]);
			expect(result[1]).toMatchObject({
				errors: [{ code: "output.writeFailed" }],
			});
			expect(result[2]).toMatchObject({ blockedBy: [result[1].label] });
			expect(await fs.exists(abs("arena.project.json"))).toBe(false);
		});

		it("should keep the sync dir warnings of a config that was not written", async () => {
			await fs.writeFile(abs("lobby/init.meta.json"), "{ nope");

			const result = await runOf([
				configOf({ syncDir: abs("dist") }),
				lobby(),
			]);

			expect(result[0]).toMatchObject({
				outcome: "notWritten",
				syncWarnings: [{ code: "output.nothingEmitted" }],
			});
		});
	});

	describe("check", () => {
		const checkOf = async (...configs: ResolvedConfig[]) =>
			(await buildServiceOfFs().check(selectionOf(...configs))).builds;

		beforeEach(async () => {
			await fs.writeFile(abs("src/A.luau"), "");
		});

		it("should build every config and write none", async () => {
			const result = await checkOf(configOf());

			expect(result).toMatchObject([
				{ outcome: "notWritten", blockedBy: [] },
			]);
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});

		it("should raise the diagnostics a build raises, the sync dir's included", async () => {
			const config = configOf({ syncDir: abs("dist") });

			const [checked] = await checkOf(config);
			const [built] = (
				await buildServiceOfFs().build(selectionOf(config))
			).builds;

			expect(checked.diagnostics).toEqual(built.diagnostics);
			expect(checked.diagnostics).toMatchObject([
				{ code: "output.nothingEmitted" },
			]);
		});

		it("should fail a config that does not build, as build does", async () => {
			await fs.writeFile(abs("src/init.meta.json"), "{ nope");

			const [checked] = await checkOf(configOf());

			expect(checked.outcome).toBe("failed");
		});
	});

	describe("rebuild", () => {
		const rebuildOf = async (
			set: BuildSet,
			previous?: LoadedBuild
		): Promise<LoadedBuild> =>
			buildServiceOfFs().rebuild(
				set,
				abs("default.rogen.json"),
				await new CoreIndexService(fs).list([abs("src")]),
				previous
			);

		beforeEach(async () => {
			await fs.writeFile(abs("src/A.luau"), "");
		});

		it("should check the sync dir of a config it hasn't built before", async () => {
			const build = await rebuildOf(
				new BuildSet([configOf({ syncDir: abs("dist") })])
			);

			expect(build.syncWarnings).toMatchObject([
				{ code: "output.nothingEmitted" },
			]);
		});

		it("should keep what it knows of the sync dir while the config is the same", async () => {
			const set = new BuildSet([configOf({ syncDir: abs("dist") })]);
			const first = await rebuildOf(set);
			await fs.writeFile(abs("dist/A.luau"), "");

			const again = await rebuildOf(set, first);

			expect(again.syncWarnings).toBe(first.syncWarnings);
		});

		it("should check the sync dir again for a new version of the config", async () => {
			const first = await rebuildOf(
				new BuildSet([configOf({ syncDir: abs("dist") })])
			);
			await fs.writeFile(abs("dist/A.luau"), "");

			const again = await rebuildOf(
				new BuildSet([configOf({ syncDir: abs("dist") })]),
				first
			);

			expect(again.syncWarnings).toEqual([]);
		});

		it("should fail a config the set blocks without writing it", async () => {
			const build = await rebuildOf(
				new BuildSet([configOf({ routes: {} })])
			);

			expect(build).toMatchObject({
				outcome: "failed",
				errors: [{ code: "route.noRoutes" }],
			});
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});
	});

	describe("locate", () => {
		const routes = {
			server: "ServerScriptService",
			"*": "ReplicatedStorage/Shared",
		};
		const locate = (config: ResolvedConfig, ...args: string[]) =>
			locateIn(buildServiceOfFs(), config, { args, cwd: abs() });

		it("should answer from the configs the set leaves and return the errors of one it blocks", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const result = (
				await buildServiceOfFs().locate(
					selectionOf(
						configOf({ routes: {}, file: abs("bare.rogen.json") }),
						configOf({ routes, outFile: abs("lobby.project.json") })
					),
					{ args: ["src/A.luau"], cwd: abs() }
				)
			).unwrap();

			expect(result.configs.map(({ config }) => config.label)).toEqual([
				"default",
			]);
			expect(result.errors).toMatchObject([
				{ code: "route.noRoutes", resource: abs("bare.rogen.json") },
			]);
		});

		it("should return the errors in the order the configs were selected", async () => {
			const broken = brokenEntry(
				[
					errorDiagnostic(
						"config.invalidSyntax",
						{ resource: abs("broken.rogen.json") },
						"not JSON"
					),
				],
				abs("broken.rogen.json")
			);
			const bare = mockEntry(
				{ rootDirs: [abs("src")], routes: {} },
				abs("bare.rogen.json")
			);
			const codes = async (...entries: ConfigEntry[]) =>
				(
					await buildServiceOfFs().locate(
						new MockConfigSelection(entries),
						{ args: [], cwd: abs() }
					)
				)
					.unwrap()
					.errors.map(({ code }) => code);

			expect(await codes(bare, broken)).toEqual([
				"route.noRoutes",
				"config.invalidSyntax",
			]);
			expect(await codes(broken, bare)).toEqual([
				"config.invalidSyntax",
				"route.noRoutes",
			]);
		});

		it("should return an error two configs share once, where the first of them is selected", async () => {
			const broken = brokenEntry(
				[
					errorDiagnostic(
						"config.invalidSyntax",
						{ resource: abs("broken.rogen.json") },
						"not JSON"
					),
				],
				abs("broken.rogen.json")
			);
			const sameOut = (file: string) =>
				mockEntry(
					{
						rootDirs: [abs("src")],
						routes,
						outFile: abs("game.project.json"),
					},
					abs(file)
				);

			const result = (
				await buildServiceOfFs().locate(
					new MockConfigSelection([
						sameOut("a.rogen.json"),
						broken,
						sameOut("b.rogen.json"),
					]),
					{ args: [], cwd: abs() }
				)
			).unwrap();

			expect(result.errors.map(({ code }) => code)).toEqual([
				"output.sameOutFile",
				"config.invalidSyntax",
			]);
		});

		it("should answer from no config that writes the file another writes, as build does", async () => {
			const result = (
				await buildServiceOfFs().locate(
					selectionOf(
						configOf({ routes }),
						configOf({ routes, file: abs("lobby.rogen.json") })
					),
					{ args: ["src/A.luau"], cwd: abs() }
				)
			).unwrap();

			expect(result.configs).toEqual([]);
			expect(result.errors).toMatchObject([
				{ code: "output.sameOutFile" },
			]);
		});

		it("should answer from the configs that load and return the errors of one that doesn't", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const errors = [
				errorDiagnostic(
					"config.invalidSyntax",
					{ resource: abs("broken.rogen.json") },
					"not JSON"
				),
			];

			const result = (
				await buildServiceOfFs().locate(
					new MockConfigSelection([
						brokenEntry(errors, abs("broken.rogen.json")),
						mockEntry(
							{
								rootDirs: [abs("src")],
								routes: { "*": "ReplicatedStorage" },
							},
							abs("default.rogen.json")
						),
					]),
					{ args: [], cwd: abs() }
				)
			).unwrap();

			expect(result.configs.map(({ config }) => config.label)).toEqual([
				"default",
			]);
			expect(result.errors).toEqual(errors);
		});

		it("should answer nothing when no config loads", async () => {
			const result = (
				await buildServiceOfFs().locate(
					new MockConfigSelection([
						brokenEntry([], abs("broken.rogen.json")),
					]),
					{ args: [], cwd: abs() }
				)
			).unwrap();

			expect(result.configs).toEqual([]);
		});

		it("should still place a file when a folder meta beside it is invalid, and keep the error", async () => {
			await fs.writeFile(abs("src/Combat/A.luau"), "");
			await fs.writeFile(abs("src/Combat/init.meta.json"), "{ nope");

			const result = (
				await locate(configOf(), abs("src/Combat/A.luau"))
			).unwrap();

			expect(result.files).toMatchObject([
				{
					status: "placed",
					instancePath: ["ReplicatedStorage", "Combat", "A"],
				},
			]);
			expect(result.diagnostics.length).toBeGreaterThan(0);
			expect(
				result.diagnostics.every(
					({ code }) => code === "meta.invalidSyntax"
				)
			).toBe(true);
		});

		it("should keep the warnings a build raises about the files it was asked about", async () => {
			const result = (
				await locate(
					configOf({
						routes: {
							server: "ServerScriptService",
							"*": "ReplicatedStorage",
						},
					}),
					abs("src/Save@sever.luau")
				)
			).unwrap();

			expect(result.diagnostics).toMatchObject([
				{ code: "route.strayAt" },
			]);
		});

		it("should name every config that declares no routes", async () => {
			const result = (
				await buildServiceOfFs().locate(
					selectionOf(
						configOf({ routes: {} }),
						configOf({
							routes: {},
							file: abs("lobby.rogen.json"),
							outFile: abs("lobby.project.json"),
						})
					),
					{ args: [], cwd: abs() }
				)
			).unwrap();

			expect(result.errors).toMatchObject([
				{ resource: abs("default.rogen.json") },
				{ resource: abs("lobby.rogen.json") },
			]);
		});

		it("should list every file and no instance without arguments", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const result = (await locate(configOf())).unwrap();

			expect(result.files.map(({ source }) => source)).toEqual([
				toPosix(abs("src/A.luau")),
			]);
			expect(result.instances).toEqual([]);
		});

		it("should find the files placed at an instance and inside it", async () => {
			await fs.writeFile(abs("src/Inventory/server/Save.luau"), "");
			await fs.writeFile(abs("src/Inventory/server/Load.luau"), "");
			await fs.writeFile(abs("src/Inventory/Types.luau"), "");

			const result = (
				await locate(
					configOf({ routes }),
					"ServerScriptService.Inventory"
				)
			).unwrap();

			expect(
				result.instances[0].files.map(({ source }) => source)
			).toEqual([
				toPosix(abs("src/Inventory/server/Load.luau")),
				toPosix(abs("src/Inventory/server/Save.luau")),
			]);
			expect(result.files).toEqual([]);
		});

		it("should find no file for an instance nothing places", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const result = (
				await locate(
					configOf({ routes }),
					"ServerScriptService.Missing:3"
				)
			).unwrap();

			expect(result.instances).toMatchObject([{ files: [] }]);
		});

		it("should place a path relative to the working directory", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const result = (await locate(configOf(), "src/A.luau")).unwrap();

			expect(result.files).toMatchObject([
				{ source: toPosix(abs("src/A.luau")), status: "placed" },
			]);
		});

		it("should read an argument as an instance unless the working directory holds that name", async () => {
			await fs.writeFile(abs("ReplicatedStorage/Shared.luau"), "");

			const result = (
				await locate(
					configOf({ routes }),
					"ServerScriptService.Inventory",
					"ReplicatedStorage/Shared.luau"
				)
			).unwrap();

			expect(
				result.instances.map(({ reference }) => reference.text)
			).toEqual(["ServerScriptService.Inventory"]);
			expect(result.files.map(({ source }) => source)).toEqual([
				toPosix(abs("ReplicatedStorage/Shared.luau")),
			]);
		});

		it("should answer paths and instances from one call", async () => {
			await fs.writeFile(abs("src/server/Save.luau"), "");

			const result = (
				await locate(
					configOf({ routes }),
					"src/server/Save.luau",
					"ServerScriptService.Save"
				)
			).unwrap();

			expect(result.files).toMatchObject([{ status: "placed" }]);
			expect(result.instances[0].files).toHaveLength(1);
		});

		it("should answer an instance from the files that exist, even beside a new path", async () => {
			await fs.writeFile(abs("src/server/Save.luau"), "");

			const result = (
				await locate(
					configOf({ routes }),
					"src/server/Load.luau",
					"ServerScriptService"
				)
			).unwrap();

			expect(result.files).toMatchObject([
				{
					source: toPosix(abs("src/server/Load.luau")),
					status: "placed",
				},
			]);
			expect(
				result.instances[0].files.map(({ source }) => source)
			).toEqual([toPosix(abs("src/server/Save.luau"))]);
		});
	});

	describe("a file whose neighbour stops the build", () => {
		const routes = {
			shared: "ReplicatedStorage/Shared",
			server: "ServerScriptService",
			"*": "ReplicatedStorage/Shared",
		};
		const ignoredAt = "src/F/Shared/Bad@server.luau";

		beforeEach(async () => {
			await fs.writeFile(abs("src/F/Shared/Good.luau"), "");
			await fs.writeFile(abs(ignoredAt), "");
		});

		it("should tell the path it can't place that the build stops on the neighbour", async () => {
			const result = (
				await locateIn(buildServiceOfFs(), configOf({ routes }), {
					args: ["src/F/Shared/Good.luau"],
					cwd: abs(),
				})
			).unwrap();

			expect(result.files).toMatchObject([
				{
					source: toPosix(abs("src/F/Shared/Good.luau")),
					exists: true,
					status: "blocked",
					by: {
						code: "route.ignoredAt",
						resource: toPosix(abs(ignoredAt)),
					},
				},
			]);
		});

		it("should tell the path with the error that the error is its own", async () => {
			const result = (
				await locateIn(buildServiceOfFs(), configOf({ routes }), {
					args: [ignoredAt],
					cwd: abs(),
				})
			).unwrap();

			expect(result.files[0]).toMatchObject({
				status: "blocked",
				by: { resource: toPosix(abs(ignoredAt)) },
			});
			expect(result.diagnostics).toMatchObject([
				{ code: "route.ignoredAt" },
			]);
		});

		it("should check a path as far as the build gets, and say what stops it", async () => {
			const found = (
				await buildServiceOfFs().diagnose(
					selectionOf(configOf({ routes })),
					{ args: ["src/F/Shared/Good.luau"], cwd: abs() }
				)
			).unwrap();

			expect(found.diagnostics).toEqual([]);
			expect(found.stoppedBy).toMatchObject([
				{ code: "route.ignoredAt" },
			]);
		});

		it("should report the error as the path's own, not as what stops the build", async () => {
			const found = (
				await buildServiceOfFs().diagnose(
					selectionOf(configOf({ routes })),
					{ args: [ignoredAt], cwd: abs() }
				)
			).unwrap();

			expect(found.diagnostics).toMatchObject([
				{ code: "route.ignoredAt" },
			]);
			expect(found.stoppedBy).toEqual([]);
		});
	});

	describe("diagnose", () => {
		it("should report a misspelt folder against a file in it, and against the folder above that", async () => {
			await fs.writeFile(abs("src/F/Sever/A.luau"), "");
			const routes = {
				server: "ServerScriptService",
				"*": "ReplicatedStorage",
			};
			const diagnose = async (arg: string) =>
				(
					await buildServiceOfFs().diagnose(
						selectionOf(configOf({ routes })),
						{ args: [arg], cwd: abs() }
					)
				).unwrap().diagnostics;

			expect(await diagnose("src/F/Sever/A.luau")).toMatchObject([
				{ code: "route.folderTypo" },
			]);
			expect(await diagnose("src/F")).toMatchObject([
				{ code: "route.folderTypo" },
			]);
		});

		it("should report the error of a config the set blocks beside what reaches the path in the others", async () => {
			await fs.writeFile(abs("src/F/Sever/A.luau"), "");

			const result = (
				await buildServiceOfFs().diagnose(
					selectionOf(
						configOf({ routes: {}, file: abs("bare.rogen.json") }),
						configOf({
							routes: {
								server: "ServerScriptService",
								"*": "ReplicatedStorage",
							},
							outFile: abs("lobby.project.json"),
						})
					),
					{ args: ["src/F/Sever/A.luau"], cwd: abs() }
				)
			).unwrap();

			expect(result.diagnostics).toMatchObject([
				{ code: "route.noRoutes", resource: abs("bare.rogen.json") },
				{ code: "route.folderTypo" },
			]);
			expect(result.stoppedBy).toEqual([]);
		});
	});

	describe("build with configs the set blocks", () => {
		const entryOf = (
			spec: ResolvedConfigSpec = {},
			file = abs("default.rogen.json")
		) =>
			mockEntry(
				{
					rootDirs: [abs("src")],
					routes: { "*": "ReplicatedStorage" },
					outFile: abs(
						`${path.basename(file, ".rogen.json")}.project.json`
					),
					...spec,
				},
				file
			);
		const buildOf = async (...entries: ConfigEntry[]) =>
			(await buildServiceOfFs().build(new MockConfigSelection(entries)))
				.builds;

		beforeEach(async () => {
			await fs.writeFile(abs("src/A.luau"), "");
		});

		it("should fail a config that declares no routes and leave the others unwritten", async () => {
			const builds = await buildOf(
				entryOf({ routes: {} }, abs("bare.rogen.json")),
				entryOf()
			);

			expect(builds).toMatchObject([
				{
					outcome: "failed",
					errors: [
						{
							code: "route.noRoutes",
							resource: abs("bare.rogen.json"),
						},
					],
				},
				{ outcome: "notWritten", blockedBy: ["bare"] },
			]);
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});

		it("should fail each config that writes one file with the same error", async () => {
			const builds = await buildOf(
				entryOf(),
				entryOf(
					{ outFile: abs("default.project.json") },
					abs("other.rogen.json")
				)
			);

			expect(builds).toMatchObject([
				{
					outcome: "failed",
					errors: [
						{
							code: "output.sameOutFile",
							resource: abs("default.project.json"),
						},
					],
				},
				{ outcome: "failed", errors: [{ code: "output.sameOutFile" }] },
			]);
		});

		it("should report a config that doesn't load beside one the set blocks", async () => {
			const builds = await buildOf(
				entryOf({ routes: {} }),
				brokenEntry([], abs("broken.rogen.json"))
			);

			expect(builds.map(({ outcome }) => outcome)).toEqual([
				"failed",
				"notLoaded",
			]);
		});
	});
});
