import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	MockConfigSelection,
	ResolvedConfigSpec,
	brokenEntry,
	mockEntry,
} from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { ConfigEntry } from "../../config/config-service.js";
import { abs, buildServiceOf, configOf, indexOf } from "./fixtures.js";

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

	describe("run", () => {
		const lobby = (spec: ResolvedConfigSpec = {}) =>
			configOf({
				file: abs("lobby.rogen.json"),
				outFile: abs("lobby.project.json"),
				rootDirs: [abs("lobby")],
				...spec,
			});

		const runOf = async (
			configs: readonly ResolvedConfig[],
			options?: { checkSyncDir?: boolean }
		) => {
			const index = await indexOf(
				store,
				fs,
				configs.flatMap(({ rootDirs }) => rootDirs)
			);
			return buildServiceOf(fs, index).run(configs, options);
		};

		const outcomesOf = (builds: Awaited<ReturnType<typeof runOf>>) =>
			builds.map(({ config, outcome }) => [config.file, outcome]);

		beforeEach(async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			await fs.writeFile(abs("lobby/B.luau"), "");
		});

		it("should index the root dirs it reads itself", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const [build] = await buildServiceOfFs().run([configOf()]);

			expect(build.summary?.roots).toMatchObject([
				{ rootDir: abs("src"), files: 1 },
			]);
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
			const result = await runOf([configOf(), lobby({ routes: {} })]);

			expect(outcomesOf(result)).toEqual([
				[abs("default.rogen.json"), "notWritten"],
				[abs("lobby.rogen.json"), "failed"],
			]);
			expect(result[1]).toMatchObject({
				errors: [{ code: "route.noRoutes" }],
			});
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
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
			expect(result[2]).toMatchObject({ errors: [] });
			expect(await fs.exists(abs("arena.project.json"))).toBe(false);
		});

		it("should keep the sync dir warnings of a config that was not written", async () => {
			const result = await runOf(
				[configOf({ syncDir: abs("dist") }), lobby({ routes: {} })],
				{ checkSyncDir: true }
			);

			expect(result[0]).toMatchObject({
				outcome: "notWritten",
				syncWarnings: [{ code: "output.nothingEmitted" }],
			});
		});

		it("should check the sync dir only when asked", async () => {
			const result = await runOf([configOf({ syncDir: abs("dist") })]);

			expect(result[0]).toMatchObject({ syncWarnings: [] });
		});
	});

	describe("locate", () => {
		const routes = {
			server: "ServerScriptService",
			"*": "ReplicatedStorage/Shared",
		};
		const locate = (config: ResolvedConfig, ...args: string[]) =>
			buildServiceOfFs().locate(config, { args, cwd: abs() });

		it("should fail when the config declares no routes", async () => {
			const result = await locate(configOf({ routes: {} }));

			expect(
				result.isErr() ? result.error.diagnostics : []
			).toMatchObject([{ code: "route.noRoutes" }]);
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

	describe("requireBuildable", () => {
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
		const check = (...entries: ConfigEntry[]) =>
			buildServiceOfFs().requireBuildable(
				new MockConfigSelection(entries)
			);
		const diagnosticsOf = (result: ReturnType<typeof check>) => {
			if (result.isOk()) throw new Error("Expected the check to fail.");
			return result.error.diagnostics;
		};

		it("should return each config", () => {
			const entry = entryOf();

			const result = check(entry);

			expect(result.unwrap()).toEqual([entry.config]);
		});

		it("should fail with a config's errors when it is invalid", () => {
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

			const result = check(entryOf(), broken);

			expect(diagnosticsOf(result)).toMatchObject([
				{ code: "config.invalidSyntax" },
			]);
		});

		it("should name each config file that declares no routes", () => {
			const result = check(
				entryOf({ routes: { "*": "Workspace" } }),
				entryOf(
					{ routes: {}, outFile: abs("bare.project.json") },
					abs("bare.rogen.json")
				)
			);

			expect(diagnosticsOf(result)).toMatchObject([
				{ code: "route.noRoutes", resource: abs("bare.rogen.json") },
			]);
		});

		it("should refuse two configs that write one file", () => {
			const result = check(
				entryOf(),
				entryOf(
					{ outFile: abs("default.project.json") },
					abs("other.rogen.json")
				)
			);

			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "output.sameOutFile",
					resource: abs("default.project.json"),
				},
			]);
		});
	});

	describe("blockedConfigs", () => {
		const blocked = (...configs: ResolvedConfig[]) =>
			buildServiceOfFs().blockedConfigs(configs);

		it("should name every config that shares an out file, each with the same error", () => {
			const result = blocked(
				configOf(),
				configOf({ file: abs("other.rogen.json") }),
				configOf({
					file: abs("lobby.rogen.json"),
					outFile: abs("lobby.project.json"),
				})
			);

			expect([...result.keys()]).toEqual([
				abs("default.rogen.json"),
				abs("other.rogen.json"),
			]);
			expect(result.get(abs("default.rogen.json"))).toMatchObject([
				{ code: "output.sameOutFile" },
			]);
			expect(result.get(abs("other.rogen.json"))).toEqual(
				result.get(abs("default.rogen.json"))
			);
		});

		it("should name a config that declares no routes", () => {
			const result = blocked(configOf({ routes: {} }));

			expect(result.get(abs("default.rogen.json"))).toMatchObject([
				{ code: "route.noRoutes" },
			]);
		});

		it("should be empty when every config can be built", () => {
			expect(blocked(configOf()).size).toBe(0);
		});
	});
});
