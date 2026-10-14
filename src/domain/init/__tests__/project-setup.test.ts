import path from "path";
import {
	withRobloxTs,
	workspaceOf,
} from "../../toolchain/__tests__/workspaces.js";
import { Darklua } from "../../toolchain/toolchain.js";
import { InitQuestions } from "../init-questions.js";
import { ProjectChoices, ProjectSetup } from "../project-setup.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { WorkspaceSpec, directory, directoryOf } from "./init-fixtures.js";
import {
	LUAU_ROUTES,
	ROBLOX_TS_ROUTES,
	luau,
	withPackages,
	defaultProjectChoices,
	planProject,
	planResult,
	plan,
	errorsOf,
	configOf,
} from "./project-setup-fixtures.js";

describe("ProjectSetup plan", () => {
	it("should plan every source path it writes", async () => {
		const choices = {
			...(await defaultProjectChoices(luau)),
			sourcePaths: ["core", "shared"],
		};

		expect(planProject({ choices }).unwrap().directories).toEqual([
			"core",
			"shared",
		]);
	});

	it("should write rogen.json", async () => {
		const { configs } = await plan(luau);

		expect(configs).toEqual(["rogen.json"]);
	});

	it("should write the starting routes explicitly", async () => {
		const config = configOf(await plan(luau));

		expect(config.routes).toEqual(LUAU_ROUTES);
	});

	it("should write fields in pipeline order", async () => {
		const { files } = await plan(
			withRobloxTs(
				{ ...luau, ...withPackages, language: "roblox-ts" },
				{ outDir: "out" }
			)
		);

		expect(Object.keys(JSON.parse(files[0].content))).toEqual([
			"$schema",
			"tree",
			"sourcePaths",
			"routes",
			"syncPath",
		]);
	});

	it("should write strict JSON with a trailing newline", async () => {
		const { files } = await plan(luau);

		expect(files[0].content.endsWith("}\n")).toBe(true);
		expect(() => JSON.parse(files[0].content)).not.toThrow();
	});

	it("should write a bare DataModel tree and no sync path or name for plain luau", async () => {
		const config = configOf(await plan(luau));

		expect(config.tree).toEqual({ $className: "DataModel" });
		expect(config.syncPath).toBeUndefined();
		expect(config.name).toBeUndefined();
	});

	it("should write the detected outDir as syncPath for roblox-ts", async () => {
		const files = await plan(
			withRobloxTs(
				{ ...luau, language: "roblox-ts" },
				{ outDir: "build" }
			)
		);

		expect(files.configs).toEqual(["rogen.json"]);
		expect(configOf(files).syncPath).toBe("build");
	});

	describe("language and darklua", () => {
		const planFor = async (
			language: WorkspaceSpec["language"],
			darklua: boolean
		) =>
			planProject({
				choices: await defaultProjectChoices(
					withRobloxTs(
						{
							...luau,
							language,
							darkluaConfig: darklua
								? ".darklua.json"
								: undefined,
						},
						{ outDir: "build" }
					)
				),
			}).unwrap();

		it("should write one config without a sync path for luau", async () => {
			const files = await planFor("luau", false);

			expect(files.configs).toEqual(["rogen.json"]);
			expect(configOf(files).syncPath).toBeUndefined();
		});

		it("should write one config synced from dist for luau with darklua", async () => {
			const files = await planFor("luau", true);

			expect(files.configs).toEqual(["rogen.json"]);
			expect(configOf(files).syncPath).toBe("dist");
		});

		it("should write one config with the outDir for roblox-ts", async () => {
			const files = await planFor("roblox-ts", false);

			expect(files.configs).toEqual(["rogen.json"]);
			expect(configOf(files).syncPath).toBe("build");
		});

		it("should write one config synced from dist for roblox-ts with darklua", async () => {
			const files = await planFor("roblox-ts", true);

			expect(files.configs).toEqual(["rogen.json"]);
			expect(configOf(files).syncPath).toBe("dist");
			expect(files.nextSteps.run).toEqual(["rbxtsc -w", "rogen serve"]);
		});

		it("should say how to run luau", async () => {
			expect((await planFor("luau", false)).nextSteps).toEqual({
				setup: [],
				run: ["rogen serve"],
				darklua: [],
				edits: ['Add your own routes under "routes" in rogen.json.'],
			});
		});

		it("should start rbxtsc first for roblox-ts", async () => {
			expect((await planFor("roblox-ts", false)).nextSteps.run).toEqual([
				"rbxtsc -w",
				"rogen serve",
			]);
		});

		it("should say what Darklua must process", async () => {
			expect((await planFor("luau", true)).nextSteps.darklua).toEqual([
				"darklua process src dist",
			]);
		});

		it("should leave the sourcemap to luau-lsp, and say how without it", async () => {
			expect((await planFor("luau", true)).nextSteps.edits.at(-1)).toBe(
				"Darklua reads sourcemap.json, which luau-lsp keeps current from default.project.json. Without luau-lsp, run: rojo sourcemap default.project.json --output sourcemap.json --watch"
			);
		});

		it("should not ask roblox-ts with darklua for a sourcemap", async () => {
			expect(
				(await planFor("roblox-ts", true)).nextSteps.edits.join("\n")
			).not.toContain("sourcemap");
		});

		it("should give each source path its own path under the sync path", async () => {
			const files = planProject({
				choices: {
					...(await defaultProjectChoices({
						...luau,
						darkluaConfig: ".darklua.json",
					})),
					sourcePaths: ["src", "lib/shared"],
				},
			}).unwrap();

			expect(files.nextSteps.darklua).toEqual([
				"darklua process src dist/src",
				"darklua process lib/shared dist/lib/shared",
			]);
		});

		it("should tell roblox-ts with darklua to process the compiled output", async () => {
			expect(
				(await planFor("roblox-ts", true)).nextSteps.darklua
			).toEqual(["darklua process build dist"]);
		});
	});

	describe("routes", () => {
		const routesOf = async (
			choices: Partial<ProjectChoices>,
			language = "luau"
		) => {
			const workspace = {
				...luau,
				language,
			} as WorkspaceSpec;
			const files = planProject({
				choices: {
					...(await defaultProjectChoices(workspace)),
					...choices,
				},
			}).unwrap();
			return configOf(files).routes;
		};

		it("should write the standard routes with capitalised keys for luau", async () => {
			expect(await routesOf({})).toEqual(LUAU_ROUTES);
		});

		it("should write the standard routes with lowercase keys for roblox-ts", async () => {
			expect(await routesOf({}, "roblox-ts")).toEqual(ROBLOX_TS_ROUTES);
		});

		it("should write exactly the ticked routes in a fixed order", async () => {
			expect(
				await routesOf({
					routes: ["starterGui", "server", "replicatedFirst"],
				})
			).toEqual({
				Server: "ServerScriptService",
				ReplicatedFirst: "ReplicatedFirst",
				StarterGui: "StarterGui",
				"*": "ReplicatedStorage/Shared",
			});
		});

		it("should camel-case the optional routes for roblox-ts", async () => {
			expect(
				await routesOf(
					{
						routes: [
							"replicatedFirst",
							"serverStorage",
							"starterGui",
						],
					},
					"roblox-ts"
				)
			).toEqual({
				replicatedFirst: "ReplicatedFirst",
				serverStorage: "ServerStorage",
				starterGui: "StarterGui",
				"*": "ReplicatedStorage/shared",
			});
		});

		it("should omit * when files that match no route are left out", async () => {
			expect(await routesOf({ fallback: false })).toEqual({
				Server: "ServerScriptService",
				Client: "StarterPlayer/StarterPlayerScripts",
				Shared: "ReplicatedStorage/Shared",
			});
		});

		it("should write * when no route is ticked, because a config with no routes can't build", async () => {
			expect(await routesOf({ routes: [], fallback: false })).toEqual({
				"*": "ReplicatedStorage/Shared",
			});
		});
	});

	describe("choices", () => {
		const planChoices = async (choices: Partial<ProjectChoices>) =>
			planProject({
				choices: {
					...(await defaultProjectChoices(luau)),
					...choices,
				},
			}).unwrap();

		it("should write the chosen source paths", async () => {
			const files = await planChoices({ sourcePaths: ["src", "shared"] });

			expect(configOf(files).sourcePaths).toEqual(["src", "shared"]);
		});

		it("should tell roblox-ts to compile the source path chosen when it is not the one it compiles", async () => {
			const plan = await planChoices({
				language: workspaceOf().languageFor("roblox-ts"),
				sourcePaths: ["game"],
			});

			expect(plan.nextSteps.setup).toEqual([
				expect.stringContaining('Set "sourcePath" to "game"'),
			]);
		});

		it("should write the chosen sync path", async () => {
			const files = await planChoices({
				language: workspaceOf().languageFor("roblox-ts"),
				syncPath: "lib",
			});

			expect(configOf(files).syncPath).toBe("lib");
		});

		it("should write optional mounts as optional paths", async () => {
			const files = await planChoices({
				mounts: [
					{
						path: "Packages",
						optional: true,
						landing: "ReplicatedStorage/Packages",
					},
					{
						path: "ServerPackages",
						optional: false,
						landing: "ServerScriptService/ServerPackages",
					},
				],
			});

			expect(configOf(files).tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					Packages: { $path: { optional: "Packages" } },
				},
				ServerScriptService: {
					ServerPackages: { $path: "ServerPackages" },
				},
			});
		});

		it("should write a bare DataModel when no mount was chosen", async () => {
			const files = await planChoices({ mounts: [] });

			expect(configOf(files).tree).toEqual({ $className: "DataModel" });
		});

		it("should write no sync path when darklua has none", async () => {
			const files = await planChoices({
				darklua: new Darklua(),
				syncPath: undefined,
			});

			expect(configOf(files).syncPath).toBeUndefined();
		});
	});

	describe("notes", () => {
		it("should say where roblox-ts syncs from", async () => {
			expect(
				(
					await plan(
						withRobloxTs(
							{ ...luau, language: "roblox-ts" },
							{ outDir: "out" }
						)
					)
				).notes
			).toEqual(["Syncing from out, where roblox-ts compiles to."]);
		});

		it("should say nothing for plain luau", async () => {
			expect((await plan(luau)).notes).toEqual([]);
		});
	});

	describe("existing files", () => {
		it("should fail when the config it would write exists", async () => {
			const result = await planResult(luau, ["rogen.json"]);

			expect(result.isErr()).toBe(true);
			expect(errorsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(directory, "rogen.json"),
				},
			]);
		});

		it("should not fail over an existing project file", async () => {
			const result = await planResult({ ...luau, ...withPackages }, [
				"default.project.json",
			]);

			expect(result.isOk()).toBe(true);
		});
	});
});

describe("an unattended run", () => {
	it("should lift a hand-written project file the config would replace", async () => {
		const choices = await defaultProjectChoices(
			luau,
			new Set(["default.project.json"])
		);

		expect(choices.tree).toMatchObject({
			kind: "lift",
			from: "default.project.json",
		});
	});

	it("should start a new tree when there is no project file", async () => {
		expect((await defaultProjectChoices(luau)).tree).toEqual({
			kind: "new",
		});
	});
});

describe("ProjectSetup project file that can't be read", () => {
	const askWith = async (fileSystem: MemoryFileSystemService) => {
		const setup = new ProjectSetup(
			directoryOf({ existing: ["default.project.json"] }),
			new InitQuestions(new MockPromptService([], false), false),
			fileSystem
		);
		const asked = await setup.ask();
		return asked.isErr() && asked.error;
	};

	it("should fail when the file it would lift does not exist", async () => {
		expect(await askWith(new MemoryFileSystemService())).toMatchObject([
			{
				code: "init.projectUnreadable",
				resource: path.join(directory, "default.project.json"),
				message: "this file does not exist, so it can't be lifted.",
			},
		]);
	});

	it("should give the reason, without a Node code, when the file it would lift is a directory", async () => {
		const fileSystem = new MemoryFileSystemService();
		await fileSystem.createDirectory(
			path.join(directory, "default.project.json")
		);

		expect(await askWith(fileSystem)).toMatchObject([
			{
				message:
					"couldn't read this file to lift it: illegal operation on a directory.",
			},
		]);
	});

	it("should fail when the file it would lift is not a project file", async () => {
		const fileSystem = new MemoryFileSystemService();
		await fileSystem.writeFile(
			path.join(directory, "default.project.json"),
			"[]"
		);

		expect(await askWith(fileSystem)).toMatchObject([
			{
				code: "init.projectUnreadable",
				message:
					"this is not a valid project file, so it can't be lifted: it must be a JSON object.",
			},
		]);
	});
});
