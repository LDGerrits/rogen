import { DisposableStore } from "../../../../base/disposable.js";
import { Diagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../../config/resolved-config.js";
import { SyncTool } from "../../../toolchain/toolchain.js";
import { CompiledPathCheck } from "../compiled-path-check.js";
import { PLACEHOLDER_SOURCE } from "../../compiled-layout.js";
import {
	abs,
	configOf as baseConfigOf,
	indexOf,
	placeFiles,
	syncTools,
	writeFiles,
} from "../../__tests__/fixtures.js";

describe("CompiledPathCheck", () => {
	describe("check", () => {
		const emittedConfigOf = (
			overrides: ResolvedConfigSpec = {}
		): ResolvedConfig =>
			baseConfigOf({ compiledPath: abs("out"), ...overrides });

		describe("nothing emitted", () => {
			let fs: MemoryFileSystemService;
			let store: DisposableStore;

			const check = async (
				fs: MemoryFileSystemService,
				config: ResolvedConfig
			): Promise<Diagnostic[]> => {
				const index = await indexOf(fs, config.sourcePaths);
				const warnings = await new CompiledPathCheck(fs).check(
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
				it("should report nothing without a compiledPath", async () => {
					await fs.writeFile(abs("src/Inventory/A.luau"), "");

					expect(
						await check(
							fs,
							emittedConfigOf({ compiledPath: undefined })
						)
					).toEqual([]);
				});

				it("should report nothing when the emitted paths exist", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");
					await fs.writeFile(abs("out/Inventory/A.luau"), "");

					expect(await check(fs, emittedConfigOf())).toEqual([]);
				});

				it("should report nothing when only some of a source path's paths exist", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");
					await fs.writeFile(abs("src/Combat/B.ts"), "");
					await fs.writeFile(abs("out/Combat/B.luau"), "");

					expect(await check(fs, emittedConfigOf())).toEqual([]);
				});

				it("should skip a source path that does not exist", async () => {
					expect(await check(fs, emittedConfigOf())).toEqual([]);
				});

				it("should skip a source path with nothing in it", async () => {
					await fs.createDirectory(abs("src"));

					expect(await check(fs, emittedConfigOf())).toEqual([]);
				});

				it("should warn once on the compiled path when it does not exist, whatever the source paths", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");
					await fs.writeFile(abs("tests/Inventory.spec.ts"), "");

					const warnings = await check(
						fs,
						emittedConfigOf({
							sourcePaths: [abs("src"), abs("tests")],
						})
					);

					expect(warnings).toHaveLength(1);
					expect(warnings[0]).toMatchObject({
						code: "output.nothingEmitted",
						resource: abs("out"),
						message:
							'the compiled path "out" doesn\'t exist yet, so Rojo has nothing to sync. Run your compiler or processor first.',
					});
				});

				it("should keep the nearest path that exists when the compiled path does", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");
					await fs.createDirectory(abs("out"));

					const warnings = await check(fs, emittedConfigOf());

					expect(warnings).toHaveLength(1);
					expect(warnings[0]).toMatchObject({
						code: "output.nothingEmitted",
						resource: abs("src"),
					});
					expect(warnings[0].message).toContain('source path "src"');
					expect(warnings[0].message).toContain('under "out"');
					expect(warnings[0].message).toContain(
						'nearest path that exists is "out" — has your compiler or processor run?'
					);
				});

				it("should take a compiled path that holds only empty folders as nothing emitted", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");
					await fs.createDirectory(abs("out/Inventory"));

					const warnings = await check(fs, emittedConfigOf());

					expect(warnings).toMatchObject([
						{ code: "output.nothingEmitted", resource: abs("src") },
					]);
				});

				it("should take a compiled path that holds only placeholder scripts as nothing emitted", async () => {
					await fs.writeFile(abs("src/Save.server.ts"), "");
					await fs.writeFile(
						abs("out/Save.server.luau"),
						PLACEHOLDER_SOURCE
					);

					const warnings = await check(fs, emittedConfigOf());

					expect(warnings).toMatchObject([
						{ code: "output.nothingEmitted", resource: abs("src") },
					]);
				});

				it("should warn once for the source path whose paths went missing and stay quiet for the other", async () => {
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
							sourcePaths: [abs("src"), abs("tests")],
						})
					);

					expect(warnings).toHaveLength(1);
					expect(warnings[0].resource).toBe(abs("src"));
					expect(warnings[0].message).toContain('source path "src"');
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
						'Found "out/src/Inventory" — is the output of your compiler or processor rooted differently?'
					);
				});

				it("should warn about a missing compiled path when only one source path has files", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");
					await fs.createDirectory(abs("tests"));

					const warnings = await check(
						fs,
						emittedConfigOf({
							sourcePaths: [abs("src"), abs("tests")],
						})
					);

					expect(warnings).toHaveLength(1);
					expect(warnings[0].resource).toBe(abs("out"));
				});

				it("should skip a source path that holds only dotfiles", async () => {
					await fs.writeFile(abs("src/.gitkeep"), "");

					expect(await check(fs, emittedConfigOf())).toEqual([]);
				});

				it("should name the compiled path as the nearest path when the source path's folder under it is missing", async () => {
					await fs.writeFile(abs("src/Inventory/A.ts"), "");
					await fs.writeFile(abs("tests/Inventory.spec.ts"), "");
					await fs.createDirectory(abs("out"));

					const warnings = await check(
						fs,
						emittedConfigOf({
							sourcePaths: [abs("src"), abs("tests")],
						})
					);

					expect(warnings.map(({ resource }) => resource)).toEqual([
						abs("src"),
						abs("tests"),
					]);
					for (const { message } of warnings)
						expect(message).toContain(
							'nearest path that exists is "out"'
						);
				});

				it.each([
					[
						"a level up",
						"out/server/Inventory/A.luau",
						"out/server/Inventory",
					],
					["two levels up", "out/Inventory/A.luau", "out/Inventory"],
				])(
					"should find output rooted %s from where it was expected",
					async (_where, written, found) => {
						await fs.writeFile(
							abs("src/server/Inventory/A.ts"),
							""
						);
						await fs.writeFile(abs("tests/unit/A.spec.ts"), "");
						await fs.writeFile(abs(written), "");

						const warnings = await check(
							fs,
							emittedConfigOf({
								sourcePaths: [
									abs("src/server"),
									abs("tests/unit"),
								],
							})
						);

						expect(
							warnings.find(
								({ resource }) => resource === abs("src/server")
							)?.message
						).toContain(`Found "${found}"`);
					}
				);

				it("should ignore dotfiles such as marker files", async () => {
					await fs.writeFile(abs("src/@server"), "");
					await fs.writeFile(abs("src/Inventory/A.luau"), "");
					await fs.writeFile(abs("out/Inventory/A.luau"), "");

					expect(await check(fs, emittedConfigOf())).toEqual([]);
				});
			});
		});

		const distConfigOf = (
			overrides: ResolvedConfigSpec = {}
		): ResolvedConfig =>
			baseConfigOf({ compiledPath: abs("dist"), ...overrides });

		describe("data file converted", () => {
			let fs: MemoryFileSystemService;
			let store: DisposableStore;

			const write = (...paths: string[]) => writeFiles(fs, ...paths);

			const check = async (
				overrides: ResolvedConfigSpec = {},
				tools: readonly SyncTool[] = syncTools
			) => {
				const config = distConfigOf(overrides);
				const index = await indexOf(fs, config.sourcePaths);
				const warnings = await new CompiledPathCheck(fs).check(
					placeFiles(index, config, tools).unwrap()
				);
				return warnings.filter(
					({ code }) => code === "output.dataFileConverted"
				);
			};

			beforeEach(() => {
				fs = new MemoryFileSystemService();
				store = new DisposableStore();
			});

			afterEach(() => {
				store[Symbol.dispose]();
			});

			it("should warn when dist/Note.lua stands where dist/Note.txt is expected", async () => {
				await write(
					"src/Note.txt",
					"src/Other.luau",
					"dist/Note.lua",
					"dist/Other.luau"
				);

				const [warning, ...others] = await check();

				expect(others).toEqual([]);
				expect(warning).toMatchObject({
					code: "output.dataFileConverted",
					resource: abs("default.project.json"),
				});
				expect(warning.message).toContain(
					`1 data file was turned into a Lua module under "dist" (src/Note.txt: expected "dist/Note.txt", found "dist/Note.lua")`
				);
				expect(warning.message).toContain("Darklua converts .txt");
			});

			it("should check every data extension", async () => {
				await write(
					"src/A.json",
					"src/B.toml",
					"src/C.yaml",
					"src/Other.luau",
					"dist/A.lua",
					"dist/B.lua",
					"dist/C.lua",
					"dist/Other.luau"
				);

				const [warning] = await check();

				expect(warning.message).toContain("3 data files were");
			});

			it("should find the .lua of a .model.json by its stem", async () => {
				await write(
					"src/D.model.json",
					"src/Other.luau",
					"dist/D.model.lua",
					"dist/Other.luau"
				);

				const [warning] = await check();

				expect(warning.message).toContain(
					'src/D.model.json: expected "dist/D.model.json", found "dist/D.model.lua"'
				);
			});

			it("should list the first few and elide the rest", async () => {
				const names = ["A", "B", "C", "D", "E"];
				await write(
					"src/Other.luau",
					"dist/Other.luau",
					...names.flatMap((name) => [
						`src/${name}.txt`,
						`dist/${name}.lua`,
					])
				);

				const [warning] = await check();

				expect(warning.message).toContain("5 data files were");
				expect(warning.message).toContain("…)");
			});

			it("should not warn about a data file that exists under the compiled path", async () => {
				await write(
					"src/Note.txt",
					"src/Other.luau",
					"dist/Note.txt",
					"dist/Note.lua",
					"dist/Other.luau"
				);

				expect(await check()).toEqual([]);
			});

			it("should not warn about a data file with no .lua beside its missing copy", async () => {
				await write(
					"src/Note.txt",
					"src/Other.luau",
					"dist/Other.luau"
				);

				expect(await check()).toEqual([]);
			});

			it("should not warn without a compiled path or before the compiler has run", async () => {
				await write("src/Note.txt", "dist/Note.lua");

				expect(await check({ compiledPath: undefined })).toEqual([]);
				expect(await check()).toEqual([]);
			});

			it("should check nothing when no tool converts data files", async () => {
				await write(
					"src/Note.txt",
					"src/Other.luau",
					"dist/Note.lua",
					"dist/Other.luau"
				);

				expect(await check({}, [])).toEqual([]);
			});

			it("should look for the module a tool says it writes, and give that tool's note", async () => {
				await write(
					"src/Note.txt",
					"src/Other.luau",
					"dist/Note.txt.luau",
					"dist/Other.luau"
				);

				const [warning] = await check({}, [
					{
						id: "other",
						dataReplacement: {
							suffix: ".txt.luau",
							note: "Other converts them.",
						},
					},
				]);

				expect(warning.message).toContain('found "dist/Note.txt.luau"');
				expect(warning.message).toContain("Other converts them.");
			});
		});

		describe("meta not synced", () => {
			let fs: MemoryFileSystemService;
			let store: DisposableStore;

			const write = (...paths: string[]) => writeFiles(fs, ...paths);

			const check = async (
				overrides: ResolvedConfigSpec = {},
				tools: readonly SyncTool[] = syncTools
			) => {
				const config = distConfigOf(overrides);
				const index = await indexOf(fs, config.sourcePaths);
				const warnings = await new CompiledPathCheck(fs).check(
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
				it("should report nothing without a compiledPath", async () => {
					await write("src/Save.server.luau", "src/Save.meta.json");

					expect(await check({ compiledPath: undefined })).toEqual(
						[]
					);
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

				it("should warn once for the meta files missing from the compiled path", async () => {
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

				it("should skip a source path with no output under the compiled path", async () => {
					await write(
						"src/Inventory/Save.server.luau",
						"src/Inventory/Save.meta.json"
					);

					expect(await check()).toEqual([]);
				});

				it("should leave out ignored meta files", async () => {
					await write(
						"src/Inventory/Save.server.luau",
						"src/Inventory/Save.meta.json",
						"dist/Inventory/Save.server.luau"
					);

					expect(
						await check({
							ignored: [abs("src/Inventory/Save.meta.json")],
						})
					).toEqual([]);
				});
			});
		});

		describe("orphan compiled files", () => {
			let fs: MemoryFileSystemService;

			const write = (...paths: string[]) => writeFiles(fs, ...paths);

			const check = async (overrides: ResolvedConfigSpec = {}) => {
				const config = distConfigOf(overrides);
				const index = await indexOf(fs, config.sourcePaths);
				const warnings = await new CompiledPathCheck(fs).check(
					placeFiles(index, config, syncTools).unwrap()
				);
				return warnings.filter(
					({ code }) => code === "compiled.orphan"
				);
			};

			beforeEach(() => {
				fs = new MemoryFileSystemService();
			});

			it("should warn about a compiled file no source makes, naming its folder", async () => {
				await write(
					"src/A/Real.luau",
					"dist/A/Real.luau",
					"dist/A/Old.luau"
				);

				const [warning, ...others] = await check();

				expect(others).toEqual([]);
				expect(warning).toMatchObject({
					code: "compiled.orphan",
					resource: abs("dist/A"),
					message:
						"dist/A/Old.luau is in the compiled path and no source file makes it, so Rojo may still sync it. Delete it, or compile again from a clean folder.",
				});
			});

			it("should not warn about a cache file the compiler writes for itself", async () => {
				await write(
					"src/A/Real.luau",
					"dist/A/Real.luau",
					"dist/rbxts.copyfiles.json"
				);

				expect(await check()).toEqual([]);
			});

			it("should still warn about a cache file's name below the compiled path's root", async () => {
				await write(
					"src/A/Real.luau",
					"dist/A/Real.luau",
					"dist/A/rbxts.copyfiles.json"
				);

				const [warning] = await check();

				expect(warning.message).toContain(
					"dist/A/rbxts.copyfiles.json"
				);
			});

			it("should warn in a folder that cannot collapse", async () => {
				await write(
					"src/A/Real.server.luau",
					"src/A/Other.luau",
					"dist/A/Real.server.luau",
					"dist/A/Other.luau",
					"dist/A/Old.luau"
				);
				await fs.writeFile(abs("src/A/Other.meta.json"), "{}");
				await fs.writeFile(abs("dist/A/Other.meta.json"), "{}");

				const [warning] = await check();

				expect(warning.message).toContain("dist/A/Old.luau");
			});

			it("should warn once per folder and list a few of its files", async () => {
				await write(
					"src/A/Real.luau",
					"dist/A/Real.luau",
					"dist/A/O1.luau",
					"dist/A/O2.luau",
					"dist/A/O3.luau",
					"dist/A/O4.luau",
					"dist/B/Gone.luau",
					"src/B/Kept.luau",
					"dist/B/Kept.luau"
				);

				const warnings = await check();

				expect(warnings.map(({ resource }) => resource)).toEqual([
					abs("dist/A"),
					abs("dist/B"),
				]);
				expect(warnings[0].message).toBe(
					"dist/A/O1.luau, dist/A/O2.luau, dist/A/O3.luau, … are in the compiled path and no source file makes them, so Rojo may still sync them. Delete them, or compile again from a clean folder."
				);
			});

			it("should find an orphan in a nested folder", async () => {
				await write(
					"src/A/B/Real.luau",
					"dist/A/B/Real.luau",
					"dist/A/B/Old.luau"
				);

				const [warning] = await check();

				expect(warning.resource).toBe(abs("dist/A/B"));
			});

			it("should not warn about a compiled file that has its source", async () => {
				await write(
					"src/A/Real.luau",
					"dist/A/Real.luau",
					"src/A/Server.server.luau",
					"dist/A/Server.server.luau",
					"src/A/Plain.lua",
					"dist/A/Plain.luau"
				);

				expect(await check()).toEqual([]);
			});

			it("should match a roblox-ts source to the .luau it compiles to", async () => {
				await write(
					"src/A/Real.ts",
					"src/A/Comp.tsx",
					"src/A/Tool.server.ts",
					"src/A/index.ts",
					"src/types.d.ts",
					"dist/A/Real.luau",
					"dist/A/Comp.luau",
					"dist/A/Tool.server.luau",
					"dist/A/init.luau"
				);

				expect(await check()).toEqual([]);
			});

			it("should warn about a roblox-ts output no .ts makes", async () => {
				await write(
					"src/A/Real.ts",
					"dist/A/Real.luau",
					"dist/A/Old.luau"
				);

				const [warning] = await check();

				expect(warning.message).toContain("dist/A/Old.luau");
			});

			it("should not warn about a file Rojo does not sync", async () => {
				await write(
					"src/A/Real.ts",
					"dist/A/Real.luau",
					"dist/A/Lib.d.ts",
					"dist/tsconfig.tsbuildinfo",
					"dist/A/notes.md"
				);

				expect(await check()).toEqual([]);
			});

			it("should still warn about an orphan Rojo syncs beside files it does not", async () => {
				await write(
					"src/A/Real.ts",
					"dist/A/Real.luau",
					"dist/A/Lib.d.ts",
					"dist/A/Old.luau"
				);

				const [warning] = await check();

				expect(warning.message).toContain("dist/A/Old.luau");
				expect(warning.message).not.toContain("Lib.d.ts");
			});

			it("should match the Lua modules a processor makes from data and meta files", async () => {
				await write(
					"src/A/Real.luau",
					"dist/A/Real.luau",
					"src/A/Rates.json",
					"dist/A/Rates.lua",
					"src/A/Model.model.json",
					"dist/A/Model.model.lua",
					"src/A/Real.meta.json",
					"dist/A/Real.meta.lua"
				);

				expect(await check()).toEqual([]);
			});

			it("should count a source Rogen leaves out as making its compiled file", async () => {
				await write(
					"src/A/Real.luau",
					"dist/A/Real.luau",
					"src/A/Spec.spec.luau",
					"dist/A/Spec.spec.luau"
				);

				expect(await check({ ignored: ["**/*.spec.luau"] })).toEqual(
					[]
				);
			});

			it("should report nothing without a compiled path", async () => {
				await write("src/A/Real.luau", "dist/A/Old.luau");

				expect(await check({ compiledPath: undefined })).toEqual([]);
			});

			it("should leave a compiled file outside the source paths' folders alone", async () => {
				await write(
					"src/A/Real.luau",
					"tests/T.luau",
					"dist/src/A/Real.luau",
					"dist/tests/T.luau",
					"dist/other/X.luau"
				);

				expect(
					await check({ sourcePaths: [abs("src"), abs("tests")] })
				).toEqual([]);
			});

			it("should report nothing when nothing is emitted for the source path", async () => {
				await write("src/A/Real.luau", "dist/Shifted/Real.luau");

				expect(await check()).toEqual([]);
			});

			it("should ignore hidden compiled files", async () => {
				await write(
					"src/A/Real.luau",
					"dist/A/Real.luau",
					"dist/A/.gitkeep"
				);

				expect(await check()).toEqual([]);
			});
		});
	});
});
