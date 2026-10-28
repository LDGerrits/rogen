import path from "path";
import {
	withRobloxTs,
	workspaceOf,
} from "../../toolchain/__tests__/workspaces.js";
import { ConfigFormatter } from "../../config/config-formatter.js";
import { InitPlan } from "../init-service.js";
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
	lifted,
} from "./project-setup-fixtures.js";

describe("ProjectSetup plan, unmounted files", () => {
	const lift = (unmounted: readonly string[]) =>
		defaultProjectChoices(luau).then((choices) =>
			planProject({
				choices: {
					...choices,
					tree: lifted({
						name: "g",
						tree: { $className: "DataModel" },
					}),
					unmounted,
				},
				existingFiles: new Set(["default.project.json"]),
			}).unwrap()
		);

	it("should warn, by code, of files Rojo ignored that a route may place", async () => {
		const planned = await lift(["src/Loose.luau", "src/x/Y.luau"]);

		expect(planned.warnings).toMatchObject([
			{
				code: "init.unmountedFiles",
				message: expect.stringContaining(
					"2 files in the source paths are mounted by no node"
				),
			},
		]);
		expect(planned.warnings[0].message).toContain(
			"src/Loose.luau, src/x/Y.luau"
		);
	});

	it("should name five files and count the rest", async () => {
		const planned = await lift(
			Array.from({ length: 8 }, (_, at) => `src/F${at}.luau`)
		);

		expect(planned.warnings[0].message).toContain("src/F4.luau and 3 more");
	});

	it("should say nothing when every file is mounted", async () => {
		expect((await lift([])).warnings).toEqual([]);
	});
});

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

	it("should write default.rogen.json", async () => {
		const { configs } = await plan(luau);

		expect(configs).toEqual(["default.rogen.json"]);
	});

	describe("other project files in the folder", () => {
		it("should name them in a note, and say they are left alone", async () => {
			const { notes } = await plan(luau, [
				"test.project.json",
				"place.project.json",
			]);

			expect(notes).toEqual([
				expect.stringContaining(
					"Left alone: place.project.json, test.project.json. Rojo runs a plain project file as it is"
				),
			]);
		});

		it("should not name default.project.json, which init replaces or lifts", async () => {
			const { notes } = await plan(luau, ["default.project.json"]);

			expect(notes.join("\n")).not.toContain("Left alone");
		});

		it("should say nothing when there are none", async () => {
			const { notes } = await plan(luau);

			expect(notes.join("\n")).not.toContain("Left alone");
		});
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
			"sourcePaths",
			"routes",
			"compiledPath",
			"tree",
		]);
	});

	it("should write strict JSON as fmt-project writes it, so a first format only adds the name Rojo gives", async () => {
		const { files } = await plan(luau);

		const config = new MemoryFileSystemService();
		await config.writeFile("/repo/default.rogen.json", files[0].content);
		const formatter = new ConfigFormatter(config);

		await formatter.format("/repo/default.rogen.json");
		const named = await config.readFile("/repo/default.rogen.json");

		expect(JSON.parse(named)).toEqual({
			...JSON.parse(files[0].content),
			name: "repo",
		});
		expect(
			(await formatter.format("/repo/default.rogen.json")).unwrap()
		).toBe(false);
	});

	it("should write a bare DataModel tree and no compiled path or name for plain luau", async () => {
		const config = configOf(await plan(luau));

		expect(config.tree).toEqual({ $className: "DataModel" });
		expect(config.compiledPath).toBeUndefined();
		expect(config.name).toBeUndefined();
	});

	it("should write the detected outDir as compiledPath for roblox-ts", async () => {
		const files = await plan(
			withRobloxTs(
				{ ...luau, language: "roblox-ts" },
				{ outDir: "build" }
			)
		);

		expect(files.configs).toEqual(["default.rogen.json"]);
		expect(configOf(files).compiledPath).toBe("build");
	});

	describe("language", () => {
		const planFor = async (language: WorkspaceSpec["language"]) =>
			planProject({
				choices: await defaultProjectChoices(
					withRobloxTs({ ...luau, language }, { outDir: "build" })
				),
			}).unwrap();

		it("should write one config without a compiled path for luau", async () => {
			const files = await planFor("luau");

			expect(files.configs).toEqual(["default.rogen.json"]);
			expect(configOf(files).compiledPath).toBeUndefined();
		});

		it("should write one config with the outDir for roblox-ts", async () => {
			const files = await planFor("roblox-ts");

			expect(files.configs).toEqual(["default.rogen.json"]);
			expect(configOf(files).compiledPath).toBe("build");
		});

		it("should write no projects or serveProject", async () => {
			const config = configOf(await planFor("luau"));

			expect(config).not.toHaveProperty("projects");
			expect(config).not.toHaveProperty("serveProject");
		});

		it("should say how to run luau", async () => {
			expect((await planFor("luau")).nextSteps).toEqual({
				setup: [],
				run: ["rogen serve"],
				edits: [
					'Add your own routes under "routes" in default.rogen.json.',
					expect.stringContaining("leave default.project.json alone"),
				],
			});
		});

		it("should start rbxtsc first for roblox-ts", async () => {
			expect((await planFor("roblox-ts")).nextSteps.run).toEqual([
				"rbxtsc -w",
				"rogen serve",
			]);
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
					fallback: false,
				})
			).toEqual({
				Server: "ServerScriptService",
				ReplicatedFirst: "ReplicatedFirst",
				StarterGui: "StarterGui",
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
						fallback: false,
					},
					"roblox-ts"
				)
			).toEqual({
				replicatedFirst: "ReplicatedFirst",
				serverStorage: "ServerStorage",
				starterGui: "StarterGui",
			});
		});

		it("should leave * out when files that match no route are left out", async () => {
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

		it("should write the chosen compiled path", async () => {
			const files = await planChoices({
				language: workspaceOf().languageFor("roblox-ts"),
				compiledPath: "lib",
			});

			expect(configOf(files).compiledPath).toBe("lib");
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
			const result = await planResult(luau, ["default.rogen.json"]);

			expect(result.isErr()).toBe(true);
			expect(errorsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(directory, "default.rogen.json"),
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

describe("ProjectSetup plan, a lifted tree", () => {
	const liftedConfig = async (text: string) => {
		const choices = await defaultProjectChoices(luau);
		const planned = planProject({
			choices: { ...choices, tree: lifted(text) },
			existingFiles: new Set(["default.project.json"]),
		}).unwrap();
		return planned.files.find(
			({ fileName }) => fileName === "default.rogen.json"
		)!.content;
	};

	it("should keep the numbers, the order of the keys, and the comments of the nodes it keeps", async () => {
		const content = await liftedConfig(
			[
				"{",
				'\t"name": "g",',
				'\t"tree": {',
				'\t\t"$className": "DataModel",',
				'\t\t"Workspace": {',
				"\t\t\t// gravity",
				'\t\t\t"$properties": { "Gravity": 50, },',
				'\t\t\t"Part": { "$className": "Part" }',
				"\t\t},",
				'\t\t"Lighting": { "$properties": { "Brightness": 2 } }',
				"\t}",
				"}",
			].join("\n")
		);

		expect(content).toContain("// gravity");
		expect(content).toContain('"Gravity": 50, }');
		expect(content).toContain('"Brightness": 2 }');
		expect(content.indexOf('"Workspace"')).toBeLessThan(
			content.indexOf('"Lighting"')
		);
		expect(content).not.toContain("\t");
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

describe("ProjectSetup plan with a test runner", () => {
	const withJest = (spec: WorkspaceSpec): WorkspaceSpec => ({
		...spec,
		testRunner: "Jest",
	});

	it("should leave the description with the specs in it, for the tests to run", async () => {
		expect(configOf(await plan(withJest(luau)))).not.toHaveProperty(
			"globIgnorePaths"
		);
	});

	it("should keep the globs a lifted project file ignores", async () => {
		const choices = {
			...(await defaultProjectChoices(withJest(luau))),
			tree: lifted({
				tree: { $className: "DataModel" },
				globIgnorePaths: ["**/*.draft.luau"],
			}),
		};

		const config = configOf(
			planProject({ choices, workspace: withJest(luau) }).unwrap()
		);

		expect(config.globIgnorePaths).toEqual(["**/*.draft.luau"]);
	});
});

describe("ProjectSetup plan, second config files", () => {
	const darkluaLuau: WorkspaceSpec = {
		...luau,
		darkluaConfig: ".darklua.json",
	};
	const files = (planned: InitPlan) =>
		planned.files.map(({ fileName }) => fileName);
	const contentOf = (planned: InitPlan, name: string) =>
		JSON.parse(
			planned.files.find((file) => file.fileName === name)!.content
		);

	it("should set up no Darklua in a new project, even beside a .darklua.json", async () => {
		const planned = await plan(darkluaLuau);

		expect(files(planned)).toEqual(["default.rogen.json", ".gitignore"]);
		expect(configOf(planned).compiledPath).toBeUndefined();
		expect(planned.summary.map(({ area }) => area)).not.toContain(
			"Darklua"
		);
		expect(planned.nextSteps.run).toEqual(["rogen serve"]);
		expect(planned.nextSteps.edits.join("\n")).not.toContain("Darklua");
	});

	it("should write no second file without a test runner", async () => {
		const planned = await plan(luau);

		expect(files(planned)).not.toContain("dist.rogen.json");
		expect(files(planned)).not.toContain("release.rogen.json");
	});

	it("should write a complete release.rogen.json that leaves the specs out when a test runner is detected", async () => {
		const planned = await plan({ ...luau, testRunner: "Jest" });

		expect(contentOf(planned, "release.rogen.json")).toMatchObject({
			name: "my-game",
			globIgnorePaths: ["**/*.spec.luau"],
			sourcePaths: ["src"],
			routes: LUAU_ROUTES,
		});
		expect(contentOf(planned, "release.rogen.json")).not.toHaveProperty(
			"compiledPath"
		);
		expect(configOf(planned)).not.toHaveProperty("globIgnorePaths");
	});

	it("should have release read the compiler's folder", async () => {
		const planned = await plan(
			withRobloxTs(
				{ ...luau, language: "roblox-ts", testRunner: "Jest" },
				{ outDir: "build" }
			)
		);

		expect(contentOf(planned, "release.rogen.json")).toMatchObject({
			globIgnorePaths: ["**/*.spec.ts"],
			compiledPath: "build",
		});
	});

	it("should ignore every project file Rogen writes", async () => {
		const planned = planProject({
			choices: { ...(await defaultProjectChoices(luau)), kind: "place" },
		}).unwrap();

		expect(
			planned.files.find(({ fileName }) => fileName === ".gitignore")
				?.content
		).toContain("sourcemap.json\n*.project.json\n");
	});

	it("should tell a lifted project to stop tracking the file Rogen writes now", async () => {
		const choices = {
			...(await defaultProjectChoices(luau)),
			tree: lifted({ name: "g", tree: { $className: "DataModel" } }),
		};

		const planned = planProject({
			choices,
			existingFiles: new Set(["default.project.json"]),
		}).unwrap();

		expect(planned.nextSteps.edits.join("\n")).toContain(
			"git rm --cached default.project.json"
		);
	});

	it("should say to edit the config, and to build after adding a feature folder", async () => {
		expect((await plan(luau)).nextSteps.edits).toContainEqual(
			expect.stringContaining(
				"After you add a feature folder, run 'rogen write'"
			)
		);
	});
});
