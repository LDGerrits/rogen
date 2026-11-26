import path from "path";
import { withRobloxTs } from "../../toolchain/__tests__/workspaces.js";
import { InitPlan } from "../init-service.js";
import {
	CANCEL,
	MockPromptService,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { WorkspaceSpec, directory, directoryOf } from "./init-fixtures.js";
import {
	LUAU_ROUTES,
	ROBLOX_TS_ROUTES,
	luau,
	withPackages,
	askProject,
	lifting,
	planResult,
	plan,
	errorsOf,
	configOf,
} from "./project-setup-fixtures.js";
import { questionsOf } from "./init-of.js";
import { setupOf } from "./init-of.js";
import { formatterOf } from "../../config/__tests__/config-of.js";

describe("ProjectSetup plan, unmounted files", () => {
	const lift = (files: readonly string[]) =>
		plan(
			lifting(
				{ name: "g", tree: { $className: "DataModel" } },
				{
					files: Object.fromEntries(files.map((file) => [file, ""])),
				}
			)
		);

	it("should leave out what Rojo ignored with globIgnorePaths, and say so", async () => {
		const planned = await lift(["src/Loose.luau", "src/x/Thing.luau"]);

		expect(configOf(planned).globIgnorePaths).toEqual([
			"src/Loose.luau",
			"src/x",
		]);
		expect(planned.warnings).toEqual([]);
		expect(planned.notes).toContainEqual(
			expect.stringContaining(
				'Left out src/Loose.luau and src/x with "globIgnorePaths", since Rojo ignored them.'
			)
		);
	});

	it("should name five paths and count the rest", async () => {
		const planned = await lift(
			Array.from({ length: 8 }, (_, at) => `src/F${at}.luau`)
		);

		expect(planned.notes).toContainEqual(
			expect.stringContaining("src/F4.luau and 3 more")
		);
	});

	it("should say nothing when every file is mounted", async () => {
		const planned = await lift([]);

		expect(planned.notes.join("\n")).not.toContain("globIgnorePaths");
		expect(configOf(planned).globIgnorePaths).toBeUndefined();
	});
});

describe("ProjectSetup plan, summary", () => {
	it("should sum up the code as its source paths, their routes and where other files go", async () => {
		const planned = await plan();

		expect(planned.summary).toContainEqual({
			area: "Code",
			text: "src → server, client, shared; other files to ReplicatedStorage/Shared",
		});
	});

	it("should list the routes a lift derives before the standard ones", async () => {
		const planned = await plan(
			lifting({
				name: "g",
				tree: {
					$className: "DataModel",
					ServerStorage: { Tools: { $path: "src/Tools" } },
				},
			})
		);

		expect(planned.summary).toContainEqual({
			area: "Code",
			text: "src → Tools, Server, Client, Shared; other files to ReplicatedStorage/Shared",
		});
	});
});

describe("ProjectSetup plan, a lifted project", () => {
	const project = { name: "g", tree: { $className: "DataModel" } };

	it("should sum it up as one place, leaving out the language it asked", async () => {
		const planned = await plan(lifting(project, { interactive: true }));

		expect(planned.summary).toContainEqual({
			area: "Project",
			text: "one place, lifting default.project.json",
		});
	});

	it("should sum up a lifted model with its language", async () => {
		const planned = await plan(lifting({ tree: { $className: "Folder" } }));

		expect(planned.summary).toContainEqual({
			area: "Project",
			text: "a model, Luau, lifting default.project.json",
		});
	});

	it("should name the other project files it leaves alone", async () => {
		const planned = await plan(
			lifting(project, { files: { "test.project.json": "{}" } })
		);

		expect(planned.notes).toContain(
			"Left alone: test.project.json. Rojo runs a plain project file as it is."
		);
	});

	it("should say to ignore the project files when .gitignore doesn't", async () => {
		const planned = await plan(
			lifting(project, { files: { ".gitignore": "node_modules\n" } })
		);

		expect(planned.nextSteps.edits).toContain(
			"Add *.project.json to .gitignore: Rogen writes those files, and they change with the tree. A clone runs 'rogen write' to make them."
		);
	});
});

describe("ProjectSetup ask, --places", () => {
	it("should refuse it for a model", async () => {
		await expect(
			askProject({ choices: { kind: "model", places: true } })
		).rejects.toMatchObject({
			message: "--places is for a place, not for a model.",
		});
	});

	it("should refuse it where src is laid out as Rojo's place template", async () => {
		await expect(
			askProject({
				files: {
					"src/server/init.server.luau": "",
					"src/shared/Hello.luau": "",
				},
				choices: { places: true },
			})
		).rejects.toMatchObject({
			message:
				"--places starts a new tree, and src is laid out as Rojo's place template, which init keeps. Leave --places out.",
		});
	});
});

describe("ProjectSetup plan", () => {
	it("should plan every source path it writes", async () => {
		const planned = await plan({
			files: {
				"src/common/Util.luau": "",
				"src/lobby/Main.server.luau": "",
			},
			choices: { places: true },
		});

		expect(planned.directories).toEqual(["src/common", "src/lobby"]);
	});

	it("should write default.rogen.json", async () => {
		const { configs } = await plan();

		expect(configs).toEqual(["default.rogen.json"]);
	});

	describe("other project files in the folder", () => {
		it("should name them in a note, and say they are left alone", async () => {
			const { notes } = await plan({
				files: {
					"test.project.json": "{}",
					"place.project.json": "{}",
				},
			});

			expect(notes).toEqual([
				expect.stringContaining(
					"Left alone: place.project.json, test.project.json. Rojo runs a plain project file as it is"
				),
			]);
		});

		it("should not name default.project.json, which init replaces or lifts", async () => {
			const { notes } = await plan(lifting({}));

			expect(notes.join("\n")).not.toContain("Left alone");
		});

		it("should say nothing when there are none", async () => {
			const { notes } = await plan();

			expect(notes.join("\n")).not.toContain("Left alone");
		});
	});

	it("should write the starting routes explicitly", async () => {
		const config = configOf(await plan());

		expect(config.routes).toEqual(LUAU_ROUTES);
	});

	it("should write fields in pipeline order", async () => {
		const planned = await plan({
			workspace: withRobloxTs(
				{ ...luau, ...withPackages, language: "roblox-ts" },
				{ outDir: "out" }
			),
		});

		expect(Object.keys(configOf(planned))).toEqual([
			"name",
			"sourcePaths",
			"routes",
			"compiledPath",
			"tree",
		]);
	});

	it("should write strict JSON as fmt-project writes it, name included, so formatting it changes nothing", async () => {
		const { files } = await plan();
		const { content } = files.find(
			({ fileName }) => fileName === "default.rogen.json"
		)!;

		const config = new MemoryFileSystemService();
		await config.writeFile("/repo/default.rogen.json", content);
		const formatter = formatterOf(config);

		expect(
			(await formatter.format("/repo/default.rogen.json")).unwrap()
		).toBe(false);
		expect(await config.readFile("/repo/default.rogen.json")).toBe(content);
	});

	it("should write a bare DataModel tree, no compiled path and the folder's name for plain luau", async () => {
		const config = configOf(await plan());

		expect(config.tree).toEqual({ $className: "DataModel" });
		expect(config.compiledPath).toBeUndefined();
		expect(config.name).toBe("my-game");
	});

	it("should write the detected outDir as compiledPath for roblox-ts", async () => {
		const files = await plan({
			workspace: withRobloxTs(
				{ ...luau, language: "roblox-ts" },
				{ outDir: "build" }
			),
		});

		expect(files.configs).toEqual(["default.rogen.json"]);
		expect(configOf(files).compiledPath).toBe("build");
	});

	describe("language", () => {
		const planFor = (language: WorkspaceSpec["language"]) =>
			plan({
				workspace: withRobloxTs(
					{ ...luau, language },
					{ outDir: "build" }
				),
			});

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
					expect.stringContaining(
						"Edit default.rogen.json, not default.project.json"
					),
				],
			});
		});

		it("should start the local rbxtsc first for roblox-ts", async () => {
			expect((await planFor("roblox-ts")).nextSteps.run).toEqual([
				"npx rbxtsc -w",
				"rogen serve",
			]);
		});
	});

	describe("routes", () => {
		const routesOf = async (language: WorkspaceSpec["language"]) =>
			configOf(await plan({ workspace: { ...luau, language } })).routes;

		it("should write the standard routes with lowercase keys for luau", async () => {
			expect(await routesOf("luau")).toEqual(LUAU_ROUTES);
		});

		it("should write the standard routes with lowercase keys for roblox-ts", async () => {
			expect(await routesOf("roblox-ts")).toEqual(ROBLOX_TS_ROUTES);
		});
	});

	it("should take the one folder that holds code as the source path", async () => {
		const files = await plan({ files: { "game/Main.server.luau": "" } });

		expect(configOf(files).sourcePaths).toEqual(["game"]);
	});

	describe("notes", () => {
		it("should say where roblox-ts syncs from", async () => {
			expect(
				(
					await plan({
						workspace: withRobloxTs(
							{ ...luau, language: "roblox-ts" },
							{ outDir: "out" }
						),
					})
				).notes
			).toEqual(["Syncing from out, where roblox-ts compiles to."]);
		});

		it("should say nothing for plain luau", async () => {
			expect((await plan()).notes).toEqual([]);
		});
	});

	describe("existing files", () => {
		it("should fail when the config it would write exists", async () => {
			const result = await planResult({
				files: { "default.rogen.json": "{}" },
			});

			expect(result.isErr()).toBe(true);
			expect(errorsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(directory, "default.rogen.json"),
				},
			]);
		});

		it("should not fail over an existing project file", async () => {
			const result = await planResult(
				lifting({}, { workspace: { ...luau, ...withPackages } })
			);

			expect(result.isOk()).toBe(true);
		});
	});
});

describe("ProjectSetup plan, a lifted tree", () => {
	const liftedConfig = async (text: string) => {
		const planned = await plan(lifting(text));
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
		const project = await askProject(lifting({}));

		expect(project.tree).toMatchObject({
			kind: "lift",
			from: "default.project.json",
		});
	});

	it("should start a new tree when there is no project file", async () => {
		expect((await askProject()).tree).toEqual({
			kind: "new",
		});
	});
});

describe("ProjectSetup project file that can't be read", () => {
	const askWith = async (fileSystem: MemoryFileSystemService) => {
		const setup = setupOf(
			directoryOf({ existing: ["default.project.json"] }),
			questionsOf(new MockPromptService([], false), false),
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
					"couldn't read this file to lift it: illegal operation on a directory. Fix the file, or move it away to start a new project.",
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
					"this is not a valid project file, so it can't be lifted: it must be a JSON object. Fix the file, or move it away to start a new project.",
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
		expect(
			configOf(await plan({ workspace: withJest(luau) }))
		).not.toHaveProperty("globIgnorePaths");
	});

	it("should keep the globs a lifted project file ignores", async () => {
		const config = configOf(
			await plan(
				lifting(
					{
						tree: { $className: "DataModel" },
						globIgnorePaths: ["**/*.draft.luau"],
					},
					{ workspace: withJest(luau) }
				)
			)
		);

		expect(config.globIgnorePaths).toEqual(["**/*.draft.luau"]);
	});

	it("should add what Rojo ignored after the globs of the lifted file", async () => {
		const config = configOf(
			await plan(
				lifting(
					{
						tree: { $className: "DataModel" },
						globIgnorePaths: ["**/*.draft.luau"],
					},
					{ files: { "src/dev/Tool.luau": "" } }
				)
			)
		);

		expect(config.globIgnorePaths).toEqual(["**/*.draft.luau", "src/dev"]);
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
		const planned = await plan({ workspace: darkluaLuau });

		expect(files(planned)).toEqual([
			"src/.gitkeep",
			".gitignore",
			"default.rogen.json",
		]);
		expect(configOf(planned).compiledPath).toBeUndefined();
		expect(planned.summary.map(({ area }) => area)).not.toContain(
			"Darklua"
		);
		expect(planned.nextSteps.run).toEqual(["rogen serve"]);
		expect(planned.nextSteps.edits.join("\n")).not.toContain("Darklua");
	});

	it("should write no second file without a test runner", async () => {
		const planned = await plan();

		expect(files(planned)).not.toContain("dist.rogen.json");
		expect(files(planned)).not.toContain("release.rogen.json");
	});

	it("should write a complete release.rogen.json that leaves the specs out when a test runner is detected", async () => {
		const planned = await plan({
			workspace: { ...luau, testRunner: "Jest" },
		});

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
		const planned = await plan({
			workspace: withRobloxTs(
				{ ...luau, language: "roblox-ts", testRunner: "Jest" },
				{ outDir: "build" }
			),
		});

		expect(contentOf(planned, "release.rogen.json")).toMatchObject({
			globIgnorePaths: ["**/*.spec.ts"],
			compiledPath: "build",
		});
	});

	it("should ignore every project file Rogen writes", async () => {
		const planned = await plan({
			choices: { kind: "place", sample: false },
		});

		expect(
			planned.files.find(({ fileName }) => fileName === ".gitignore")
				?.content
		).toContain("sourcemap.json\n*.project.json\n");
	});

	it.each([
		[true, true],
		[false, false],
	])(
		"should tell a lifted project to stop tracking the file Rogen writes now when git tracks it (tracked: %s)",
		async (tracksProjectFile, told) => {
			const planned = await plan(
				lifting(
					{ name: "g", tree: { $className: "DataModel" } },
					{ tracksProjectFile }
				)
			);

			expect(
				planned.nextSteps.edits.some((edit) =>
					edit.includes("git rm --cached default.project.json")
				)
			).toBe(told);
		}
	);

	it("should say to edit the config and not the project file, and link the routing docs", async () => {
		expect((await plan()).nextSteps.edits).toContainEqual(
			expect.stringContaining(
				"which 'rogen write' replaces. Routes and the tree: https://rogen-roblox.vercel.app/docs/v2/routing"
			)
		);
	});

	it("should name every config to edit when it writes several", async () => {
		const planned = await plan({
			workspace: { ...luau, testRunner: "Jest" },
		});

		expect(planned.nextSteps.edits).toContainEqual(
			"Edit default.rogen.json and release.rogen.json, not their project files, which 'rogen write' replaces. Routes and the tree: https://rogen-roblox.vercel.app/docs/v2/routing"
		);
	});

	it("should send the user to the README only when it writes one", async () => {
		const withSample = { choices: {} };

		expect((await plan(withSample)).nextSteps.edits).toContainEqual(
			"See README.md for routes and the tree."
		);
		expect(
			(await plan({ ...withSample, files: { "README.md": "# Mine" } }))
				.nextSteps.edits
		).toContainEqual(expect.stringContaining("/docs/v2/routing"));
	});

	it("should leave the routing docs out for a lift that takes no routes", async () => {
		const { edits } = (
			await plan(lifting({ name: "g", tree: { $className: "Model" } }))
		).nextSteps;

		expect(edits).toContainEqual(
			"Edit default.rogen.json, not default.project.json, which 'rogen write' replaces."
		);
	});
});

describe("ProjectSetup ask", () => {
	const askIn = async (
		files: Readonly<Record<string, string>>,
		prompts = new MockPromptService([], false)
	) => {
		const fileSystem = new MemoryFileSystemService();
		await fileSystem.createDirectory(directory);
		for (const [file, content] of Object.entries(files))
			await fileSystem.writeFile(path.join(directory, file), content);
		const setup = setupOf(
			directoryOf({ existing: Object.keys(files) }),
			questionsOf(prompts, prompts.isInteractive, {}),
			fileSystem
		);
		return (await setup.ask()).unwrap();
	};

	it("should answer nothing when the sample question is cancelled", async () => {
		expect(
			await askIn({}, new MockPromptService({ sample: CANCEL }))
		).toBeUndefined();
	});

	it.each([
		["a root that mounts nothing", { $className: "Folder" }, "model"],
		[
			"a root that mounts a server script",
			{ $path: "Plugin.server.luau" },
			"plugin",
		],
	])("should lift %s as a %s", async (_, tree, kind) => {
		expect((await askProject(lifting({ tree }))).kind).toBe(kind);
	});

	it("should build a lifted model under the folder's name when the project file names none", async () => {
		const planned = await plan(lifting({ tree: { $className: "Folder" } }));

		expect(planned.nextSteps.run).toEqual([
			'rogen build -o "my-game.rbxmx"',
		]);
	});

	it.each([
		["node_modules\n", true],
		["node_modules\n *.project.json \n", false],
	])(
		"should say to ignore the project files when .gitignore holds %j (told: %s)",
		async (gitignore, told) => {
			const planned = await plan({ files: { ".gitignore": gitignore } });

			expect(
				planned.nextSteps.edits.includes(
					"Add *.project.json to .gitignore: Rogen writes those files, and they change with the tree. A clone runs 'rogen write' to make them."
				)
			).toBe(told);
		}
	);
});
