import { jest } from "@jest/globals";
import path from "path";
import { toPosix } from "../../../base/path.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	errorDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	MockConfigSelection,
	ResolvedConfigSpec,
	selectionOf,
	brokenEntry,
	mockEntry,
} from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { WriteSet, LoadedConfig } from "../write.js";
import { ConfigEntry } from "../../config/config-service.js";
import { abs, writeServiceOf, configOf, locateIn } from "./fixtures.js";

describe("CoreWriteService", () => {
	let fs: MemoryFileSystemService;

	const writeServiceOfFs = () => writeServiceOf(fs, new CoreIndexService(fs));

	beforeEach(() => {
		fs = new MemoryFileSystemService();
	});

	describe("build", () => {
		const lobby = (spec: ResolvedConfigSpec = {}) =>
			configOf({
				file: abs("lobby/default.rogen.json"),
				name: "lobby",
				sourcePaths: [abs("lobby/src")],
				...spec,
			});

		const runOf = async (configs: readonly ResolvedConfig[]) => {
			return (await writeServiceOfFs().write(selectionOf(...configs)))
				.outcomes;
		};

		const loadable = (file: string, spec: ResolvedConfigSpec = {}) =>
			mockEntry(
				{
					name: path.basename(path.dirname(file)),
					sourcePaths: [abs("src")],
					routes: { "*": "ReplicatedStorage" },
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
			await fs.writeFile(abs("lobby/src/B.luau"), "");
		});

		it("should write only the project file of the config it is given, beside that config", async () => {
			const [build] = (
				await writeServiceOfFs().write(
					selectionOf(configOf({ file: abs("dist.rogen.json") }))
				)
			).outcomes;

			expect(build.outcome).toBe("wrote");
			expect(await fs.exists(abs("dist.project.json"))).toBe(true);
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});

		it("should index the source paths it reads itself", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const [build] = (
				await writeServiceOfFs().write(selectionOf(configOf()))
			).outcomes;

			expect(build).toMatchObject({
				summary: { roots: [{ sourcePath: abs("src"), files: 1 }] },
			});
		});

		it("should report a write that fails as that config's error, and write nothing after it", async () => {
			jest.spyOn(fs, "writeFile").mockRejectedValueOnce(
				new Error("disk full")
			);

			const { outcomes } = await writeServiceOfFs().write(
				selectionOf(configOf(), lobby())
			);

			expect(outcomes.map(({ outcome }) => outcome)).toEqual([
				"failed",
				"notWritten",
			]);
			expect(
				outcomes[0].outcome === "failed" &&
					outcomes[0].errors.map(({ code }) => code)
			).toEqual(["output.writeFailed"]);
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
			expect(await fs.exists(abs("lobby/default.project.json"))).toBe(
				false
			);
		});

		it("should write every config's project file and say what each did", async () => {
			const result = await runOf([configOf(), lobby()]);

			expect(outcomesOf(result)).toEqual([
				[abs("default.rogen.json"), "wrote"],
				[abs("lobby/default.rogen.json"), "wrote"],
			]);
			expect(result).toMatchObject([
				{ summary: { roots: [{ files: 1 }] } },
				{ summary: { roots: [{ files: 1 }] } },
			]);
			expect(await fs.exists(abs("default.project.json"))).toBe(true);
			expect(await fs.exists(abs("lobby/default.project.json"))).toBe(
				true
			);
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
			await fs.writeFile(abs("lobby/src/init.meta.json"), "{ nope");

			const result = await runOf([configOf(), lobby()]);

			expect(outcomesOf(result)).toEqual([
				[abs("default.rogen.json"), "notWritten"],
				[abs("lobby/default.rogen.json"), "failed"],
			]);
			expect(result[1]).toMatchObject({
				errors: expect.arrayContaining([
					expect.objectContaining({ code: "meta.invalidSyntax" }),
				]),
			});
			expect(result[0]).toMatchObject({ blockedBy: [result[1].file] });
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});

		it("should report a config that doesn't load beside the ones that do, and write nothing", async () => {
			const result = (
				await writeServiceOfFs().write(
					new MockConfigSelection([
						loadable(abs("default.rogen.json")),
						brokenEntry(
							[
								errorDiagnostic(
									"config.invalidSyntax",
									{
										resource: abs(
											"broken/default.rogen.json"
										),
									},
									"invalid JSONC: expected '}'."
								),
							],
							abs("broken/default.rogen.json")
						),
					])
				)
			).outcomes;

			expect(outcomesOf(result)).toEqual([
				[abs("default.rogen.json"), "notWritten"],
				[abs("broken/default.rogen.json"), "notLoaded"],
			]);
			expect(result[0]).toMatchObject({
				blockedBy: [abs("broken/default.rogen.json")],
			});
			expect(result[1]).toMatchObject({
				file: abs("broken/default.rogen.json"),
				errors: [{ code: "config.invalidSyntax" }],
			});
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});

		it("should write the configs that load beside one that doesn't, when they are independent", async () => {
			await fs.writeFile(abs("lobby/src/init.meta.json"), "{ nope");

			const result = (
				await writeServiceOfFs().write(
					new MockConfigSelection([
						loadable(abs("default.rogen.json")),
						brokenEntry([], abs("broken/default.rogen.json")),
						loadable(abs("lobby/default.rogen.json"), {
							sourcePaths: [abs("lobby/src")],
						}),
					]),
					{ independent: true }
				)
			).outcomes;

			expect(outcomesOf(result)).toEqual([
				[abs("default.rogen.json"), "wrote"],
				[abs("broken/default.rogen.json"), "notLoaded"],
				[abs("lobby/default.rogen.json"), "failed"],
			]);
			expect(await fs.exists(abs("default.project.json"))).toBe(true);
		});

		it("should keep the selection order when a config that doesn't load comes first", async () => {
			const result = (
				await writeServiceOfFs().write(
					new MockConfigSelection([
						brokenEntry([], abs("a/default.rogen.json")),
						loadable(abs("default.rogen.json")),
					])
				)
			).outcomes;

			expect(result.map(({ file }) => file)).toEqual([
				abs("a/default.rogen.json"),
				abs("default.rogen.json"),
			]);
		});

		it("should block every other config on each one that fails or doesn't load", async () => {
			await fs.writeFile(abs("lobby/src/init.meta.json"), "{ nope");

			const result = (
				await writeServiceOfFs().write(
					new MockConfigSelection([
						loadable(abs("default.rogen.json")),
						brokenEntry([], abs("broken/default.rogen.json")),
						loadable(abs("lobby/default.rogen.json"), {
							sourcePaths: [abs("lobby/src")],
						}),
					])
				)
			).outcomes;

			expect(result[0]).toMatchObject({
				blockedBy: [
					abs("broken/default.rogen.json"),
					abs("lobby/default.rogen.json"),
				],
			});
		});

		it("should stop at the first config that cannot be written", async () => {
			await fs.createDirectory(abs("lobby/default.project.json"));
			await fs.writeFile(abs("arena/src/C.luau"), "");

			const result = await runOf([
				configOf(),
				lobby(),
				lobby({
					file: abs("arena/default.rogen.json"),
					name: "arena",
					sourcePaths: [abs("arena/src")],
				}),
			]);

			expect(outcomesOf(result)).toEqual([
				[abs("default.rogen.json"), "wrote"],
				[abs("lobby/default.rogen.json"), "failed"],
				[abs("arena/default.rogen.json"), "notWritten"],
			]);
			expect(result[1]).toMatchObject({
				errors: [{ code: "output.writeFailed" }],
			});
			expect(result[2]).toMatchObject({ blockedBy: [result[1].file] });
			expect(await fs.exists(abs("arena/default.project.json"))).toBe(
				false
			);
		});

		it("should write the tree of a config without routes as written, and scan nothing", async () => {
			const tree = {
				$className: "DataModel",
				Workspace: { $className: "Workspace" },
				ReplicatedStorage: { Vendor: { $path: "vendor" } },
			};
			const config = configOf({
				routes: {},
				sourcePaths: [],
				project: { tree },
			});

			const [build] = await runOf([config]);

			expect(build).toMatchObject({
				outcome: "wrote",
				summary: { roots: [], routes: [], unrouted: 0 },
				warnings: [
					{ code: "scan.unmountedSource", resource: abs("src") },
				],
			});
			expect(
				JSON.parse(await fs.readFile(abs("default.project.json")))
			).toEqual({
				tree,
			});
		});

		it("should not warn about a stale project file, which it is about to write", async () => {
			await fs.writeFile(abs("default.project.json"), "{}");

			const [build] = await runOf([configOf()]);

			expect(build.outcome).toBe("wrote");
			expect(build.warnings).toEqual([]);
		});

		it("should keep the compiled path warnings of a config that was not written", async () => {
			await fs.writeFile(abs("lobby/src/init.meta.json"), "{ nope");

			const result = await runOf([
				configOf({ compiledPath: abs("dist") }),
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
			(await writeServiceOfFs().check(selectionOf(...configs))).outcomes;

		beforeEach(async () => {
			await fs.writeFile(abs("src/A.luau"), "");
		});

		it("should build every config and write none", async () => {
			const result = await checkOf(configOf());

			expect(result).toMatchObject([{ outcome: "wouldWrite" }]);
			expect(result[0]).not.toHaveProperty("blockedBy");
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});

		it("should raise the diagnostics a build raises, the compiled path's included", async () => {
			const config = configOf({ compiledPath: abs("dist") });

			const [checked] = await checkOf(config);
			const [built] = (
				await writeServiceOfFs().write(selectionOf(config))
			).outcomes;

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

		describe("staleProjectFiles", () => {
			it("should list the project files that differ, and only those", async () => {
				const config = configOf();
				await fs.writeFile(abs("default.project.json"), "{}");

				const stale = await writeServiceOfFs().staleProjectFiles(
					selectionOf(config)
				);

				expect(stale).toMatchObject([
					{
						code: "output.differs",
						resource: abs("default.project.json"),
					},
				]);
			});

			it("should find nothing when no project file is on disk", async () => {
				expect(
					await writeServiceOfFs().staleProjectFiles(
						selectionOf(configOf())
					)
				).toEqual([]);
			});
		});

		describe("a Rojo project file adopted as the config", () => {
			const adopted = () =>
				configOf({ file: abs("default.project.json") });

			it("should leave the file as it is and call it unchanged", async () => {
				await fs.writeFile(abs("default.project.json"), "{}");

				const [build] = (
					await writeServiceOfFs().write(selectionOf(adopted()))
				).outcomes;

				expect(build.outcome).toBe("unchanged");
				expect(await fs.readFile(abs("default.project.json"))).toBe(
					"{}"
				);
			});

			it("should leave a file Rogen wrote earlier as it is, with its config gone", async () => {
				const service = writeServiceOfFs();
				await service.write(selectionOf(configOf()));
				const written = await fs.readFile(abs("default.project.json"));

				const [build] = (await service.write(selectionOf(adopted())))
					.outcomes;

				expect(build.outcome).toBe("unchanged");
				expect(await fs.readFile(abs("default.project.json"))).toBe(
					written
				);
			});

			it("should pass a check with its config gone", async () => {
				const service = writeServiceOfFs();
				await service.write(selectionOf(configOf()));

				const [checked] = (await service.check(selectionOf(adopted())))
					.outcomes;

				expect(checked.errors).toEqual([]);
			});

			it("should not call it stale", async () => {
				await fs.writeFile(abs("default.project.json"), "{}");

				expect(
					await writeServiceOfFs().staleProjectFiles(
						selectionOf(adopted())
					)
				).toEqual([]);
			});
		});

		describe("a project file edited by hand", () => {
			it("should be written over by a build", async () => {
				const service = writeServiceOfFs();
				await service.write(selectionOf(configOf()));
				const file = JSON.parse(
					await fs.readFile(abs("default.project.json"))
				);
				file.tree.Extra = { $className: "Folder" };
				await fs.writeFile(
					abs("default.project.json"),
					JSON.stringify(file)
				);

				const [built] = (await service.write(selectionOf(configOf())))
					.outcomes;

				expect(built.outcome).toBe("wrote");
				expect(
					await fs.readFile(abs("default.project.json"))
				).not.toContain("Extra");
			});

			it("should be a stale file to check, as any other that differs", async () => {
				await fs.writeFile(
					abs("default.project.json"),
					'{"tree":{"Extra":{}}}'
				);

				const [checked] = await checkOf(configOf());

				expect(checked.warnings).toMatchObject([
					{ code: "output.differs" },
				]);
			});
		});

		describe("a project file on disk", () => {
			it("should warn when it differs from what a build would write", async () => {
				await fs.writeFile(abs("default.project.json"), "{}");

				const [checked] = await checkOf(configOf());

				expect(checked.warnings).toMatchObject([
					{
						severity: DiagnosticSeverity.Warning,
						code: "output.differs",
						resource: abs("default.project.json"),
						message: expect.stringContaining("rogen write"),
					},
				]);
				expect(await fs.readFile(abs("default.project.json"))).toBe(
					"{}"
				);
			});

			it("should name the config to build when it is not the default", async () => {
				await fs.writeFile(abs("dist.project.json"), "{}");

				const [checked] = await checkOf(
					configOf({ file: abs("dist.rogen.json") })
				);

				expect(checked.warnings).toMatchObject([
					{
						code: "output.differs",
						resource: abs("dist.project.json"),
						message: expect.stringContaining(
							"Run 'rogen write dist.rogen.json' to write it again; what it holds comes from dist.rogen.json"
						),
						fixes: [
							{
								run: {
									command: "rogen write dist.rogen.json",
									cwd: abs(),
								},
							},
						],
					},
				]);
			});

			it("should say what to run, and offer it as a fix", async () => {
				await fs.writeFile(abs("default.project.json"), "{}");

				const [checked] = await checkOf(configOf());

				expect(checked.warnings).toMatchObject([
					{
						message: expect.stringContaining(
							"its sources changed since it was written. Run 'rogen write'"
						),
						fixes: [
							{
								run: {
									command: "rogen write",
									cwd: abs("."),
								},
							},
						],
					},
				]);
			});

			it("should not warn when it holds the bytes a build would write", async () => {
				const config = configOf();
				await writeServiceOfFs().write(selectionOf(config));

				const [checked] = await checkOf(config);

				expect(checked.warnings).toEqual([]);
			});

			it("should warn when a build has not written it since the sources changed", async () => {
				const config = configOf();
				await writeServiceOfFs().write(selectionOf(config));
				await fs.writeFile(abs("src/B.luau"), "");

				const [checked] = await checkOf(config);

				expect(checked.warnings).toMatchObject([
					{ code: "output.differs" },
				]);
			});

			it("should not warn when there is none", async () => {
				const [checked] = await checkOf(configOf());

				expect(checked.warnings).toEqual([]);
			});
		});
	});

	describe("rebuild", () => {
		const rebuildOf = async (
			set: WriteSet,
			previous?: LoadedConfig
		): Promise<LoadedConfig> =>
			writeServiceOfFs().rewrite(
				set,
				abs("default.project.json"),
				await new CoreIndexService(fs).list([abs("src")]),
				previous
			);

		beforeEach(async () => {
			await fs.writeFile(abs("src/A.luau"), "");
		});

		it("should check the compiled path of a config it hasn't built before", async () => {
			const build = await rebuildOf(
				new WriteSet([configOf({ compiledPath: abs("dist") })])
			);

			expect(build.syncWarnings).toMatchObject([
				{ code: "output.nothingEmitted" },
			]);
		});

		it("should keep what it knows of the compiled path while the config is the same", async () => {
			const set = new WriteSet([configOf({ compiledPath: abs("dist") })]);
			const first = await rebuildOf(set);
			await fs.writeFile(abs("dist/A.luau"), "");

			const again = await rebuildOf(set, first);

			expect(again.syncWarnings).toBe(first.syncWarnings);
		});

		it("should check the compiled path again for a new version of the config", async () => {
			const first = await rebuildOf(
				new WriteSet([configOf({ compiledPath: abs("dist") })])
			);
			await fs.writeFile(abs("dist/A.luau"), "");

			const again = await rebuildOf(
				new WriteSet([configOf({ compiledPath: abs("dist") })]),
				first
			);

			expect(again.syncWarnings).toEqual([]);
		});

		it("should write the project file of the config", async () => {
			const build = await rebuildOf(new WriteSet([configOf()]));

			expect(build.outcome).toBe("wrote");
			expect(await fs.exists(abs("default.project.json"))).toBe(true);
		});

		it("should say unchanged for a project file that is up to date", async () => {
			const set = new WriteSet([configOf()]);
			const first = await rebuildOf(set);

			const again = await rebuildOf(set, first);

			expect(again.outcome).toBe("unchanged");
		});
	});

	describe("locate", () => {
		const routes = {
			server: "ServerScriptService",
			"*": "ReplicatedStorage/Shared",
		};
		const locate = (config: ResolvedConfig, ...args: string[]) =>
			locateIn(writeServiceOfFs(), config, { args, cwd: abs() });

		it("should return the errors in the order the configs were selected", async () => {
			const broken = (name: string) =>
				brokenEntry(
					[
						errorDiagnostic(
							`config.${name}`,
							{ resource: abs(`${name}/default.rogen.json`) },
							"not JSON"
						),
					],
					abs(`${name}/default.rogen.json`)
				);
			const codes = async (...entries: ConfigEntry[]) =>
				(
					await writeServiceOfFs().locate(
						new MockConfigSelection(entries),
						{ args: [], cwd: abs() }
					)
				)
					.unwrap()
					.errors.map(({ code }) => code);

			expect(await codes(broken("first"), broken("second"))).toEqual([
				"config.first",
				"config.second",
			]);
			expect(await codes(broken("second"), broken("first"))).toEqual([
				"config.second",
				"config.first",
			]);
		});

		it("should return an error two configs share once, where the first of them is selected", async () => {
			const shared = errorDiagnostic(
				"config.sharedField",
				{ resource: abs("shared.json") },
				"not JSON"
			);
			const broken = (name: string, ...errors: Diagnostic[]) =>
				brokenEntry(errors, abs(`${name}/default.rogen.json`));

			const result = (
				await writeServiceOfFs().locate(
					new MockConfigSelection([
						broken("a", shared),
						broken(
							"b",
							errorDiagnostic(
								"config.invalidSyntax",
								{ resource: abs("b/default.rogen.json") },
								"not JSON"
							)
						),
						broken("c", shared),
					]),
					{ args: [], cwd: abs() }
				)
			).unwrap();

			expect(result.errors.map(({ code }) => code)).toEqual([
				"config.sharedField",
				"config.invalidSyntax",
			]);
		});

		it("should answer from the configs that load and return the errors of one that doesn't", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const errors = [
				errorDiagnostic(
					"config.invalidSyntax",
					{ resource: abs("broken/default.rogen.json") },
					"not JSON"
				),
			];

			const result = (
				await writeServiceOfFs().locate(
					new MockConfigSelection([
						brokenEntry(errors, abs("broken/default.rogen.json")),
						mockEntry(
							{
								sourcePaths: [abs("src")],
								routes: { "*": "ReplicatedStorage" },
							},
							abs("default.rogen.json")
						),
					]),
					{ args: [], cwd: abs() }
				)
			).unwrap();

			expect(result.configs.map(({ config }) => config.file)).toEqual([
				abs("default.rogen.json"),
			]);
			expect(result.errors).toEqual(errors);
		});

		it("should fail with the errors of the configs that did not load, then those that stop a config from being placed", async () => {
			const failure = errorDiagnostic(
				"config.invalidSyntax",
				{ resource: abs("broken/default.rogen.json") },
				"not JSON"
			);

			const result = await writeServiceOfFs().locate(
				new MockConfigSelection([
					brokenEntry([failure], abs("broken/default.rogen.json")),
					mockEntry({
						sourcePaths: [abs("src")],
						routes: { "*": "ReplicatedStorage" },
						project: {
							tree: {
								$className: "DataModel",
								ReplicatedStorage: { $path: "src" },
							},
						},
					}),
				]),
				{ args: [], cwd: abs() }
			);

			expect(result.isErr() && result.error.diagnostics).toMatchObject([
				{ code: "config.invalidSyntax" },
				{
					code: "tree.mountsSourcePath",
					resource: abs("default.rogen.json"),
				},
			]);
		});

		it("should answer nothing when no config loads", async () => {
			const result = (
				await writeServiceOfFs().locate(
					new MockConfigSelection([
						brokenEntry([], abs("broken/default.rogen.json")),
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

		it("should say a file is outside a config that declares no routes", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const result = (
				await locate(
					configOf({ routes: {}, sourcePaths: [] }),
					"src/A.luau"
				)
			).unwrap();

			expect(result.files).toEqual([
				{
					status: "outside",
					source: toPosix(abs("src/A.luau")),
					exists: true,
				},
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
				await locateIn(writeServiceOfFs(), configOf({ routes }), {
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
				await locateIn(writeServiceOfFs(), configOf({ routes }), {
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
				await writeServiceOfFs().diagnose(
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
				await writeServiceOfFs().diagnose(
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
					await writeServiceOfFs().diagnose(
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

		it("should report what a check raises when no path is asked about", async () => {
			await fs.writeFile(abs("src/F/Sever/A.luau"), "");

			const found = (
				await writeServiceOfFs().diagnose(
					selectionOf(
						configOf({
							routes: {
								server: "ServerScriptService",
								"*": "ReplicatedStorage",
							},
						})
					)
				)
			).unwrap();

			expect(found.diagnostics).toMatchObject([
				{ code: "route.folderTypo" },
			]);
			expect(found.stoppedBy).toEqual([]);
		});

		it("should report what is wrong with a meta file that applies to nothing, from the folder it is in", async () => {
			await fs.writeFile(abs("src/I/Nope.meta.json"), "{}");
			await fs.writeFile(abs("src/I/B.luau"), "");
			const diagnose = async (arg: string) =>
				(
					await writeServiceOfFs().diagnose(
						selectionOf(
							configOf({ routes: { "*": "ReplicatedStorage" } })
						),
						{ args: [arg], cwd: abs() }
					)
				).unwrap().diagnostics;

			const file = await diagnose("src/I/Nope.meta.json");

			expect(file).not.toEqual([]);
			expect(await diagnose("src/I")).toEqual(file);
		});

		it("should say the build stops on a meta error that is not about the path", async () => {
			await fs.writeFile(abs("src/Combat/A.luau"), "");
			await fs.writeFile(abs("src/Combat/init.meta.json"), "{ nope");
			await fs.writeFile(abs("src/B.luau"), "");

			const found = (
				await writeServiceOfFs().diagnose(selectionOf(configOf()), {
					args: ["src/B.luau"],
					cwd: abs(),
				})
			).unwrap();

			expect(found.diagnostics).toEqual([]);
			expect(
				found.stoppedBy.map(({ code, resource }) => [code, resource])
			).toEqual(
				expect.arrayContaining([
					["meta.invalidSyntax", abs("src/Combat/init.meta.json")],
				])
			);
		});

		it("should report the error of a config that did not load beside what reaches the path in the others", async () => {
			await fs.writeFile(abs("src/F/Sever/A.luau"), "");
			const failure = errorDiagnostic(
				"config.invalidSyntax",
				{ resource: abs("broken/default.rogen.json") },
				"not JSON"
			);

			const result = (
				await writeServiceOfFs().diagnose(
					new MockConfigSelection([
						brokenEntry(
							[failure],
							abs("broken/default.rogen.json")
						),
						mockEntry({
							sourcePaths: [abs("src")],
							routes: {
								server: "ServerScriptService",
								"*": "ReplicatedStorage",
							},
						}),
					]),
					{ args: ["src/F/Sever/A.luau"], cwd: abs() }
				)
			).unwrap();

			expect(result.diagnostics).toMatchObject([
				{ code: "config.invalidSyntax" },
				{ code: "route.folderTypo" },
			]);
			expect(result.stoppedBy).toEqual([]);
		});
	});
});
