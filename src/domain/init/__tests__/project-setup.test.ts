import path from "path";
import {
	withRobloxTs,
	workspaceOf,
} from "../../toolchain/__tests__/workspaces.js";
import { Darklua } from "../../toolchain/toolchain.js";
import { InitQuestions } from "../init-questions.js";
import { PlaceFolder } from "../place-folder.js";
import { ProjectChoices, ProjectSetup } from "../project-setup.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	WorkspaceSpec,
	directory,
	directoryOf,
	placeFoldersOf,
} from "./init-fixtures.js";
import {
	LUAU_ROUTES,
	ROBLOX_TS_ROUTES,
	luau,
	withPackages,
	defaultProjectChoices,
	planProject,
	planResult,
	plan,
	directoriesOf,
	errorsOf,
	configOf,
} from "./project-setup-fixtures.js";

describe("ProjectSetup plan", () => {
	describe("directories", () => {
		it("should plan every root dir it writes", async () => {
			expect(
				await directoriesOf(luau, { rootDirs: ["core", "shared"] })
			).toEqual(["core", "shared"]);
		});

		it("should plan each place folder after the root dirs", async () => {
			expect(
				await directoriesOf(luau, {
					rootDirs: ["src"],
					places: [
						{
							name: "lobby",
							folder: new PlaceFolder(
								"places/lobby",
								false,
								false
							),
						},
						{
							name: "match",
							folder: new PlaceFolder(
								"places/match",
								false,
								false
							),
						},
					],
				})
			).toEqual(["src", "places/lobby/src", "places/match/src"]);
		});
	});
	describe("modes", () => {
		const modesOf = async (spec: WorkspaceSpec, modes: boolean) => {
			const choices = {
				...(await defaultProjectChoices(
					spec,
					"default",
					new Set(),
					false
				)),
				modes,
			};
			const files = planProject({
				choices,
				projectName: "my-game",
				directory,
				existingFiles: new Set(),
			}).unwrap();
			return {
				config: configOf(files, "default.rogen.json"),
				edits: files.nextSteps.edits,
			};
		};

		it("should write dev and prod, prod leaving out Luau specs", async () => {
			const { config, edits } = await modesOf(luau, true);

			expect(config.modes).toEqual({
				dev: {},
				prod: { exclude: ["**/*.spec.luau"] },
			});
			expect(edits).toContain(
				"Build a release without specs with rogen build --mode prod; default.rogen.json declares the modes."
			);
		});

		it("should leave out roblox-ts specs by their source extension", async () => {
			const { config } = await modesOf(
				{ ...luau, language: "roblox-ts" },
				true
			);

			expect(config.modes?.prod.exclude).toEqual(["**/*.spec.ts"]);
		});

		it("should write no modes unless asked to", async () => {
			const { config, edits } = await modesOf(luau, false);

			expect(config).not.toHaveProperty("modes");
			expect(edits.join("\n")).not.toContain("--mode");
		});
	});

	it("should write default.rogen.json for the default name", async () => {
		const { configs } = await plan(luau);

		expect(configs.map((config) => config.fileName)).toEqual([
			"default.rogen.json",
		]);
	});

	it("should write <name>.rogen.json for a named config", async () => {
		const { configs } = await plan(luau, "lobby");

		expect(configs.map((config) => config.fileName)).toEqual([
			"lobby.rogen.json",
		]);
	});

	it("should write the starting routes explicitly", async () => {
		const config = configOf(await plan(luau), "default.rogen.json");

		expect(config.routes).toEqual(LUAU_ROUTES);
	});

	it("should write fields in pipeline order", async () => {
		const { configs } = await plan(
			withRobloxTs(
				{ ...luau, ...withPackages, language: "roblox-ts" },
				{ outDir: "out" }
			),
			"default"
		);

		expect(Object.keys(JSON.parse(configs[0].content))).toEqual([
			"$schema",
			"rootDirs",
			"routes",
			"template",
			"syncDir",
		]);
	});

	it("should write strict JSON with a trailing newline", async () => {
		const { configs } = await plan(luau);

		expect(configs[0].content.endsWith("}\n")).toBe(true);
		expect(() => JSON.parse(configs[0].content)).not.toThrow();
	});

	it("should write neither sync dir nor template for plain luau", async () => {
		const config = configOf(await plan(luau), "default.rogen.json");

		expect(config.syncDir).toBeUndefined();
		expect(config.template).toBeUndefined();
		expect(config.extends).toBeUndefined();
	});

	it("should write the detected outDir as syncDir for roblox-ts", async () => {
		const { configs } = await plan(
			withRobloxTs(
				{ ...luau, language: "roblox-ts" },
				{ outDir: "build" }
			)
		);

		expect(configs).toHaveLength(1);
		expect(JSON.parse(configs[0].content).syncDir).toBe("build");
	});

	describe("darklua", () => {
		const darklua: WorkspaceSpec = {
			...luau,
			darkluaConfig: ".darklua.json",
		};

		it("should write a source-rooted default and a sync config extending it", async () => {
			const files = await plan(darklua);

			expect(files.configs.map((config) => config.fileName)).toEqual([
				"default.rogen.json",
				"sync.rogen.json",
			]);
			const source = configOf(files, "default.rogen.json");
			const synced = configOf(files, "sync.rogen.json");
			expect(source.syncDir).toBeUndefined();
			expect(source.routes).toEqual(LUAU_ROUTES);
			expect(synced.extends).toBe("./default.rogen.json");
			expect(synced.syncDir).toBe("dist");
		});

		it("should add only syncDir to the extending config", async () => {
			const synced = configOf(await plan(darklua), "sync.rogen.json");

			expect(Object.keys(synced)).toEqual([
				"$schema",
				"extends",
				"syncDir",
			]);
		});

		it("should name the pair <name> and <name>-sync for a named config", async () => {
			const files = await plan(darklua, "lobby");

			expect(files.configs.map((config) => config.fileName)).toEqual([
				"lobby.rogen.json",
				"lobby-sync.rogen.json",
			]);
			expect(configOf(files, "lobby-sync.rogen.json").extends).toBe(
				"./lobby.rogen.json"
			);
		});

		it("should put the template in the source-rooted config only", async () => {
			const files = await plan({ ...darklua, ...withPackages });

			expect(configOf(files, "default.rogen.json").template).toBe(
				"template.project.json"
			);
			expect(configOf(files, "sync.rogen.json").template).toBeUndefined();
		});
	});

	describe("language and darklua", () => {
		const planFor = async (
			language: WorkspaceSpec["language"],
			darklua: boolean,
			name = "default"
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
					),
					name,
					new Set(),
					false
				),
				projectName: "my-game",
				directory,
				existingFiles: new Set(),
			}).unwrap();

		it("should write one config without a sync dir for luau", async () => {
			const files = await planFor("luau", false);

			expect(files.configs.map((file) => file.fileName)).toEqual([
				"default.rogen.json",
			]);
			expect(
				configOf(files, "default.rogen.json").syncDir
			).toBeUndefined();
		});

		it("should write a source-rooted default and a sync config for luau with darklua", async () => {
			const files = await planFor("luau", true);

			expect(files.configs.map((file) => file.fileName)).toEqual([
				"default.rogen.json",
				"sync.rogen.json",
			]);
			expect(
				configOf(files, "default.rogen.json").syncDir
			).toBeUndefined();
			expect(configOf(files, "sync.rogen.json")).toMatchObject({
				extends: "./default.rogen.json",
				syncDir: "dist",
			});
		});

		it("should write one config with the outDir for roblox-ts", async () => {
			const files = await planFor("roblox-ts", false);

			expect(files.configs.map((file) => file.fileName)).toEqual([
				"default.rogen.json",
			]);
			expect(configOf(files, "default.rogen.json").syncDir).toBe("build");
		});

		it("should write a config synced from the compiler's output and one synced from dist for roblox-ts with darklua", async () => {
			const files = await planFor("roblox-ts", true);

			expect(files.configs.map((file) => file.fileName)).toEqual([
				"default.rogen.json",
				"sync.rogen.json",
			]);
			expect(configOf(files, "default.rogen.json")).toMatchObject({
				syncDir: "build",
			});
			expect(configOf(files, "sync.rogen.json")).toEqual({
				$schema: expect.any(String),
				extends: "./default.rogen.json",
				syncDir: "dist",
			});
			expect(files.nextSteps.run).toEqual(["rbxtsc -w", "rogen serve"]);
		});

		it("should say how to run luau", async () => {
			expect(await (await planFor("luau", false)).nextSteps).toEqual({
				setup: [],
				run: ["rogen serve"],
				darklua: [],
				edits: [
					'Add your own routes under "routes" in default.rogen.json.',
					'Declare variants under "variants" in default.rogen.json to swap in files like Analytics.mock.luau, and turn them on in a mode or with --variant.',
				],
			});
		});

		it("should name the config when it is written beside another, which a bare serve would share a port with", async () => {
			const files = await plan(luau, "default", ["game.rogen.json"]);

			expect(files.nextSteps.run).toEqual(["rogen serve default"]);
		});

		it("should start rbxtsc first for roblox-ts", async () => {
			expect(
				await (
					await planFor("roblox-ts", false)
				).nextSteps.run
			).toEqual(["rbxtsc -w", "rogen serve"]);
		});

		it("should say what Darklua must process", async () => {
			expect(
				await (
					await planFor("luau", true)
				).nextSteps.darklua
			).toEqual(["darklua process src dist"]);
		});

		it("should watch both configs and serve the synced one", async () => {
			expect((await planFor("luau", true)).nextSteps.run).toEqual([
				"rogen serve",
			]);
			expect(
				(await planFor("luau", true, "lobby")).nextSteps.run
			).toEqual([
				"rogen serve lobby-sync",
				"rojo sourcemap lobby.project.json --output sourcemap.json --watch",
			]);
		});

		it("should leave the sourcemap to luau-lsp for default, and say how without it", async () => {
			expect((await planFor("luau", true)).nextSteps.edits.at(-1)).toBe(
				"Darklua reads sourcemap.json, which luau-lsp keeps current from default.project.json. Without luau-lsp, run: rojo sourcemap default.project.json --output sourcemap.json --watch"
			);
		});

		it("should give each root dir its own path under the sync dir", async () => {
			const files = planProject({
				choices: {
					...(await defaultProjectChoices(
						{ ...luau, darkluaConfig: ".darklua.json" },
						"default",
						new Set(),
						false
					)),
					rootDirs: ["src", "lib/shared"],
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(),
			}).unwrap();

			expect(files.nextSteps.darklua).toEqual([
				"darklua process src dist/src",
				"darklua process lib/shared dist/lib/shared",
			]);
		});

		it("should point the routes hint at the named config for luau with darklua", async () => {
			expect(
				await (
					await planFor("luau", true, "lobby")
				).nextSteps.edits
			).toEqual([
				'Add your own routes under "routes" in lobby.rogen.json.',
				'Declare variants under "variants" in lobby.rogen.json to swap in files like Analytics.mock.luau, and turn them on in a mode or with --variant.',
			]);
		});

		it("should mention variants with a .ts variant for roblox-ts", async () => {
			expect(
				(await planFor("roblox-ts", false)).nextSteps.edits.at(-1)
			).toBe(
				'Declare variants under "variants" in default.rogen.json to swap in files like Analytics.mock.ts, and turn them on in a mode or with --variant.'
			);
		});

		it("should tell roblox-ts with darklua to process the compiled output", async () => {
			expect(
				await (
					await planFor("roblox-ts", true)
				).nextSteps.darklua
			).toEqual(["darklua process build dist"]);
		});

		it("should carry the config name into the commands", async () => {
			expect(
				await (
					await planFor("luau", false, "lobby")
				).nextSteps
			).toEqual({
				setup: [],
				run: ["rogen serve lobby"],
				darklua: [],
				edits: [
					'Add your own routes under "routes" in lobby.rogen.json.',
					'Declare variants under "variants" in lobby.rogen.json to swap in files like Analytics.mock.luau, and turn them on in a mode or with --variant.',
				],
			});
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
					...(await defaultProjectChoices(
						workspace,
						"default",
						new Set(),
						false
					)),
					...choices,
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(),
			}).unwrap();
			return configOf(files, "default.rogen.json").routes;
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
					...(await defaultProjectChoices(
						luau,
						"default",
						new Set(),
						false
					)),
					...choices,
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(),
			}).unwrap();

		it("should write the chosen root dirs", async () => {
			const files = await planChoices({ rootDirs: ["src", "shared"] });

			expect(configOf(files, "default.rogen.json").rootDirs).toEqual([
				"src",
				"shared",
			]);
		});

		it("should write the chosen sync dir", async () => {
			const files = await planChoices({
				language: workspaceOf().languageFor("roblox-ts"),
				syncDir: "lib",
			});

			expect(configOf(files, "default.rogen.json").syncDir).toBe("lib");
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

			expect(JSON.parse(files.template!.content).tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					Packages: { $path: { optional: "Packages" } },
				},
				ServerScriptService: {
					ServerPackages: { $path: "ServerPackages" },
				},
			});
		});

		it("should not write a template when no mount was chosen", async () => {
			const files = await planChoices({ mounts: [] });

			expect(files.template).toBeUndefined();
			expect(
				configOf(files, "default.rogen.json").template
			).toBeUndefined();
		});

		it("should extend the source config without a sync dir when none was chosen", async () => {
			const files = await planChoices({
				darklua: new Darklua(),
				syncDir: undefined,
			});

			expect(
				configOf(files, "default.rogen.json").syncDir
			).toBeUndefined();
		});
	});

	describe("notes", () => {
		it("should say where roblox-ts syncs from", async () => {
			expect(
				await (
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
			expect(await (await plan(luau)).notes).toEqual([]);
		});
	});

	describe("existing files", () => {
		it("should fail when the config it would write exists", async () => {
			const result = await planResult(luau, "default", [
				"default.rogen.json",
			]);

			expect(result.isErr()).toBe(true);
			expect(errorsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(directory, "default.rogen.json"),
				},
			]);
		});

		it("should allow a named config beside an existing default config", async () => {
			const result = await planResult(luau, "lobby", [
				"default.rogen.json",
			]);

			expect(result.isOk()).toBe(true);
		});

		it("should report every darklua config that already exists", async () => {
			const result = await planResult(
				{ ...luau, darkluaConfig: ".darklua.json" },
				"default",
				["default.rogen.json", "sync.rogen.json"]
			);

			expect(errorsOf(result).map((error) => error.resource)).toEqual([
				path.join(directory, "default.rogen.json"),
				path.join(directory, "sync.rogen.json"),
			]);
		});

		it("should not fail over an existing template or project file", async () => {
			const result = await planResult(
				{ ...luau, ...withPackages },
				"default",
				["template.project.json", "default.project.json"]
			);

			expect(result.isOk()).toBe(true);
		});
	});
});

describe("ProjectSetup with several places", () => {
	const lobby = {
		name: "lobby",
		folder: new PlaceFolder("places/lobby", false, false),
	};
	const arena = {
		name: "arena",
		folder: new PlaceFolder("places/arena", false, false),
	};

	const planPlaces = async (
		spec: WorkspaceSpec,
		overrides: Partial<ProjectChoices>
	) =>
		planProject({
			choices: {
				...(await defaultProjectChoices(
					spec,
					"default",
					new Set(),
					false
				)),
				places: [lobby, arena],
				...overrides,
			},
			projectName: "my-game",
			directory,
			existingFiles: new Set(),
		}).unwrap();

	it("should give each place its own template, name and port, in order", async () => {
		const { placeTemplates } = await planPlaces(luau, {});

		expect(
			placeTemplates.map(({ fileName, content }) => [
				fileName,
				JSON.parse(content),
			])
		).toEqual([
			[
				"places/lobby/template.project.json",
				{
					name: "Lobby",
					servePort: 34873,
					tree: { $className: "DataModel" },
				},
			],
			[
				"places/arena/template.project.json",
				{
					name: "Arena",
					servePort: 34874,
					tree: { $className: "DataModel" },
				},
			],
		]);
	});

	it("should serve every place at once, with no need to swap between them", async () => {
		const { nextSteps } = await planPlaces(luau, {});

		expect(nextSteps.run).toEqual(["rogen serve"]);
		expect(nextSteps.edits.join("\n")).not.toContain("Swap");
	});

	it("should tell roblox-ts to compile the shared code from where it moved", async () => {
		const spec = withRobloxTs(
			{ language: "roblox-ts" },
			{ outDir: "out", rootDir: "src", tsconfigHasInclude: true }
		);

		const { nextSteps } = await planPlaces(spec, {
			rootDirs: ["places/shared/src"],
			templateDir: "places/shared",
		});

		expect(nextSteps.setup).toContain(
			'Set "rootDir" to "places/shared/src" and "include" to ["places/shared/src"] in tsconfig.json, so roblox-ts compiles the shared code from there.'
		);
	});

	it("should leave roblox-ts's rootDir alone when the shared code stays there", async () => {
		const spec = withRobloxTs(
			{ language: "roblox-ts" },
			{ outDir: "out", rootDir: "src", tsconfigHasInclude: true }
		);

		const { nextSteps } = await planPlaces(spec, { rootDirs: ["src"] });

		expect(nextSteps.setup.join("\n")).not.toContain('"rootDir"');
	});
});

describe("an unattended run", () => {
	it("should copy a hand-written project file the config would replace", async () => {
		expect(
			await (
				await defaultProjectChoices(
					luau,
					"default",
					new Set(["default.project.json"]),
					false
				)
			).template
		).toEqual({
			kind: "copy",
			from: "default.project.json",
			content: "{}",
		});
	});

	it("should leave a project file that a config writes alone", async () => {
		expect(
			await (
				await defaultProjectChoices(
					luau,
					"lobby",
					new Set(["game.project.json", "game.rogen.json"]),
					false
				)
			).template
		).toEqual({ kind: "new" });
	});

	it("should leave out a detected place whose name would write over a file of the project", async () => {
		const workspace = { ...luau, places: ["default", "lobby"] };

		expect(
			(
				await defaultProjectChoices(
					workspace,
					"default",
					new Set(),
					true
				)
			).places.map(({ name }) => name)
		).toEqual(["lobby"]);
	});

	it("should take the detected places only when asked to", async () => {
		const workspace = { ...luau, places: ["lobby"] };
		expect(
			await (
				await defaultProjectChoices(
					workspace,
					"default",
					new Set(),
					true
				)
			).places.map(({ name }) => name)
		).toEqual(["lobby"]);
		expect(
			await (
				await defaultProjectChoices(
					workspace,
					"default",
					new Set(),
					false
				)
			).places
		).toEqual([]);
	});
});

describe("ProjectSetup template that can't be read", () => {
	it("should fail when the file it would copy to the template can't be read", async () => {
		const setup = new ProjectSetup(
			directoryOf({ existing: ["default.project.json"] }),
			new InitQuestions(new MockPromptService([], false), false),
			new MemoryFileSystemService(),
			placeFoldersOf()
		);

		const asked = await setup.ask();

		expect(asked.isErr() && asked.error).toMatchObject([
			{
				code: "init.templateUnreadable",
				resource: path.join(directory, "default.project.json"),
				message: "this file does not exist, so it can't be copied.",
			},
		]);
	});

	it("should give the reason, without a Node code, when the file it would copy is a directory", async () => {
		const fileSystem = new MemoryFileSystemService();
		await fileSystem.createDirectory(
			path.join(directory, "default.project.json")
		);
		const setup = new ProjectSetup(
			directoryOf({ existing: ["default.project.json"] }),
			new InitQuestions(new MockPromptService([], false), false),
			fileSystem,
			placeFoldersOf(fileSystem)
		);

		const asked = await setup.ask();

		expect(asked.isErr() && asked.error).toMatchObject([
			{
				message:
					"couldn't read this file to copy it: illegal operation on a directory.",
			},
		]);
	});
});
