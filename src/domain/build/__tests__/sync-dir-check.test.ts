import { DisposableStore } from "../../../base/disposable.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { SyncTool } from "../../toolchain/toolchain.js";
import { SyncDirCheck } from "../sync-layout.js";
import {
	abs,
	configOf as baseConfigOf,
	indexOf,
	placeFiles,
	syncTools,
	writeFiles,
} from "./fixtures.js";

describe("SyncDirCheck", () => {
	describe("check", () => {
		const emittedConfigOf = (
			overrides: ResolvedConfigSpec = {}
		): ResolvedConfig =>
			baseConfigOf({ syncDir: abs("out"), ...overrides });

		describe("nothing emitted", () => {
			let fs: MemoryFileSystemService;
			let store: DisposableStore;

			const check = async (
				fs: MemoryFileSystemService,
				config: ResolvedConfig
			): Promise<Diagnostic[]> => {
				const index = await indexOf(store, fs, config.rootDirs);
				const warnings = await new SyncDirCheck(fs).check(
					placeFiles(index, config, syncTools).unwrap()
				);
				return warnings.filter(
					({ code }) => code === "output.nothingEmitted"
				);
			};

			beforeEach(async () => {
				fs = new MemoryFileSystemService();
				store = new DisposableStore();
			});

			afterEach(() => {
				store[Symbol.dispose]();
			});

			describe("rule", () => {
				it("should report nothing without a syncDir", async () => {
					await fs.writeFile(abs("src/Inventory/A.luau"), "");

					expect(
						await check(fs, emittedConfigOf({ syncDir: undefined }))
					).toEqual([]);
				});

				it("should report nothing when the emitted paths exist", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");
					await fs.writeFile(abs("out/Inventory/A.luau"), "");

					expect(await check(fs, emittedConfigOf())).toEqual([]);
				});

				it("should report nothing when only some of a root dir's paths exist", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");
					await fs.writeFile(abs("src/Combat/B.ts"), "");
					await fs.writeFile(abs("out/Combat/B.luau"), "");

					expect(await check(fs, emittedConfigOf())).toEqual([]);
				});

				it("should skip a root dir that does not exist", async () => {
					expect(await check(fs, emittedConfigOf())).toEqual([]);
				});

				it("should skip a root dir with nothing in it", async () => {
					await fs.createDirectory(abs("src"));

					expect(await check(fs, emittedConfigOf())).toEqual([]);
				});

				it("should warn when the sync dir does not exist, pointing at the nearest path that does", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");

					const warnings = await check(fs, emittedConfigOf());

					expect(warnings).toHaveLength(1);
					expect(warnings[0]).toMatchObject({
						code: "output.nothingEmitted",
						resource: abs("src"),
					});
					expect(warnings[0].message).toContain('root dir "src"');
					expect(warnings[0].message).toContain('under "out"');
					expect(warnings[0].message).toContain(
						'nearest path that exists is "."'
					);
				});

				it("should warn once for the root dir whose paths went missing and stay quiet for the other", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");
					await fs.writeFile(abs("tests/Inventory.spec.ts"), "");
					await fs.writeFile(abs("out/Inventory/A.luau"), "");
					await fs.writeFile(
						abs("out/tests/Inventory.spec.luau"),
						""
					);

					const warnings = await check(
						fs,
						emittedConfigOf({
							rootDirs: [abs("src"), abs("tests")],
						})
					);

					expect(warnings).toHaveLength(1);
					expect(warnings[0].resource).toBe(abs("src"));
					expect(warnings[0].message).toContain('root dir "src"');
					expect(warnings[0].message).toContain('under "out/src"');
					expect(warnings[0].message).toContain(
						'Found "out/Inventory"'
					);
				});

				it("should find output rooted one level deeper than expected", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");
					await fs.writeFile(abs("out/src/Inventory/A.luau"), "");

					const warnings = await check(fs, emittedConfigOf());

					expect(warnings).toHaveLength(1);
					expect(warnings[0].message).toContain('under "out"');
					expect(warnings[0].message).toContain(
						'Found "out/src/Inventory"'
					);
				});

				it("should ignore dotfiles such as marker files", async () => {
					await fs.writeFile(abs("src/.server"), "");
					await fs.writeFile(abs("src/Inventory/A.luau"), "");
					await fs.writeFile(abs("out/Inventory/A.luau"), "");

					expect(await check(fs, emittedConfigOf())).toEqual([]);
				});
			});
		});

		const distConfigOf = (
			overrides: ResolvedConfigSpec = {}
		): ResolvedConfig =>
			baseConfigOf({ syncDir: abs("dist"), ...overrides });

		describe("meta not synced", () => {
			let fs: MemoryFileSystemService;
			let store: DisposableStore;

			const write = (...paths: string[]) => writeFiles(fs, ...paths);

			const check = async (
				overrides: ResolvedConfigSpec = {},
				tools: readonly SyncTool[] = syncTools
			) => {
				const config = distConfigOf(overrides);
				const index = await indexOf(store, fs, config.rootDirs);
				const warnings = await new SyncDirCheck(fs).check(
					placeFiles(index, config, tools).unwrap()
				);
				return warnings.filter(
					({ code }) => code === "output.metaNotSynced"
				);
			};

			beforeEach(() => {
				fs = new MemoryFileSystemService();
				store = new DisposableStore();
			});

			afterEach(() => {
				store[Symbol.dispose]();
			});

			describe("checkSyncMeta", () => {
				it("should report nothing without a syncDir", async () => {
					await write("src/Save.server.luau", "src/Save.meta.json");

					expect(await check({ syncDir: undefined })).toEqual([]);
				});

				it("should report nothing when every meta file was copied", async () => {
					await write(
						"src/Inventory/Save.server.ts",
						"src/Inventory/Save.meta.json",
						"src/Inventory/init.meta.json",
						"dist/Inventory/Save.server.luau",
						"dist/Inventory/Save.meta.json",
						"dist/Inventory/init.meta.json"
					);

					expect(await check()).toEqual([]);
				});

				it("should warn once for the meta files missing from the sync dir", async () => {
					await write(
						"src/Inventory/Save.server.luau",
						"src/Inventory/Save.meta.json",
						"src/Inventory/init.meta.json",
						"dist/Inventory/Save.server.luau"
					);

					const warnings = await check();

					expect(warnings).toHaveLength(1);
					expect(warnings[0]).toMatchObject({
						code: "output.metaNotSynced",
						resource: abs("default.project.json"),
					});
					expect(warnings[0].message).toContain(
						`2 meta files have no copy under "dist" (${abs("src/Inventory/Save.meta.json")}, ${abs("src/Inventory/init.meta.json")})`
					);
					expect(warnings[0].message).not.toContain(".meta.lua");
				});

				it("should say the processor converted a meta file it turned into .meta.lua", async () => {
					await write(
						"src/Inventory/Save.server.luau",
						"src/Inventory/Save.meta.json",
						"dist/Inventory/Save.server.luau",
						"dist/Inventory/Save.meta.lua"
					);

					const warnings = await check();

					expect(warnings).toHaveLength(1);
					expect(warnings[0].message).toContain(
						"The processor turned it into .meta.lua"
					);
				});

				it("should count only the meta files the processor converted", async () => {
					await write(
						"src/Inventory/Save.server.luau",
						"src/Inventory/Save.meta.json",
						"src/Inventory/init.meta.json",
						"dist/Inventory/Save.server.luau",
						"dist/Inventory/Save.meta.lua"
					);

					const warnings = await check();

					expect(warnings[0].message).toContain(
						"The processor turned 1 of them into .meta.lua"
					);
				});

				it("should describe whatever conversion a processor contributes", async () => {
					await write(
						"src/Inventory/Save.server.luau",
						"src/Inventory/Save.meta.json",
						"dist/Inventory/Save.server.luau",
						"dist/Inventory/Save.meta.yaml"
					);

					const warnings = await check({}, [
						{
							id: "yaml",
							metaReplacement: {
								suffix: ".meta.yaml",
								note: "Yaml it is.",
							},
						},
					]);

					expect(warnings[0].message).toContain(
						"The processor turned it into .meta.yaml"
					);
					expect(warnings[0].message).toContain("Yaml it is.");
				});

				it("should count only the meta files converted the way the message names", async () => {
					await write(
						"src/Inventory/Save.server.luau",
						"src/Inventory/Save.meta.json",
						"src/Inventory/Load.server.luau",
						"src/Inventory/Load.meta.json",
						"dist/Inventory/Save.server.luau",
						"dist/Inventory/Save.meta.yaml",
						"dist/Inventory/Load.server.luau",
						"dist/Inventory/Load.meta.toml"
					);

					const warnings = await check({}, [
						{
							id: "yaml",
							metaReplacement: {
								suffix: ".meta.yaml",
								note: "Yaml.",
							},
						},
						{
							id: "toml",
							metaReplacement: {
								suffix: ".meta.toml",
								note: "Toml.",
							},
						},
					]);

					expect(warnings[0].message).toContain(
						"The processor turned 1 of them into"
					);
				});

				it("should not mention a conversion when no processor contributes one", async () => {
					await write(
						"src/Inventory/Save.server.luau",
						"src/Inventory/Save.meta.json",
						"dist/Inventory/Save.server.luau",
						"dist/Inventory/Save.meta.lua"
					);

					const warnings = await check({}, []);

					expect(warnings[0].message).not.toContain(
						"The processor turned"
					);
				});

				it("should leave out meta that no file claims", async () => {
					await write(
						"src/Inventory/Save.server.luau",
						"src/Inventory/Save.server.meta.json",
						"dist/Inventory/Save.server.luau"
					);

					expect(await check()).toEqual([]);
				});

				it("should skip a root dir with no output under the sync dir", async () => {
					await write(
						"src/Inventory/Save.server.luau",
						"src/Inventory/Save.meta.json"
					);

					expect(await check()).toEqual([]);
				});

				it("should leave out excluded meta files", async () => {
					await write(
						"src/Inventory/Save.server.luau",
						"src/Inventory/Save.meta.json",
						"dist/Inventory/Save.server.luau"
					);

					expect(
						await check({
							exclude: [abs("src/Inventory/Save.meta.json")],
						})
					).toEqual([]);
				});
			});
		});
	});
});
