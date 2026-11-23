import path from "path";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { InitChoices, InitPlan } from "../init-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { initServiceOf } from "./init-of.js";
import { configServiceOf } from "../../config/__tests__/config-of.js";

const directory = path.resolve("/mock/my-game");

describe("init for several places", () => {
	let fileSystem: MemoryFileSystemService;
	let processes: MockProcessService;

	beforeEach(async () => {
		fileSystem = new MemoryFileSystemService();
		processes = new MockProcessService();
		processes.installed.set("rojo", "/bin/rojo");
		processes.outputs.set("/bin/rojo", {
			code: 0,
			stdout: "Rojo 7.7.1\n",
			stderr: "",
		});
		await fileSystem.createDirectory(directory);
	});

	const serviceFor = () => {
		const environmentService = new NativeEnvironmentService({}, directory);
		const configs = configServiceOf(fileSystem, environmentService);
		return initServiceOf(
			fileSystem,
			new MockPromptService([], false),
			environmentService,
			processes,
			configs,
			new MockLifecycleService()
		);
	};

	const plan = async (
		choices: InitChoices = {},
		place?: string
	): Promise<InitPlan> =>
		(
			await serviceFor().plan({
				ask: false,
				place,
				choices: { places: true, skipGit: true, ...choices },
			})
		).unwrap() as InitPlan;

	const put = (file: string, content = "") =>
		fileSystem.writeFile(path.join(directory, file), content);

	const fileOf = (planned: InitPlan, name: string) =>
		planned.files.find(({ fileName }) => fileName === name);

	const jsonOf = (planned: InitPlan, name: string) =>
		JSON.parse(fileOf(planned, name)?.content ?? "{}");

	const names = (planned: InitPlan) =>
		planned.files.map(({ fileName }) => fileName);

	describe("a new Luau project", () => {
		it("should write each place as a folder under projects, with the shared code beside it", async () => {
			const planned = await plan();

			expect(names(planned)).toEqual(
				expect.arrayContaining([
					"projects/game/default.rogen.json",
					"projects/common/src/Greeter/Shared/Greeting.luau",
					"projects/common/src/Greeter/Server/Greeter.server.luau",
					"projects/common/src/Greeter/Client/Greeter.client.luau",
					"projects/game/src/Main/Server/Main.server.luau",
				])
			);
			expect(names(planned)).not.toContain("game.rogen.json");
			expect(names(planned)).not.toContain("default.rogen.json");
			expect(planned.directories).toEqual([
				"projects/common/src",
				"projects/game/src",
			]);
		});

		it("should have the place's script greet from the place", async () => {
			const script = fileOf(
				await plan(),
				"projects/game/src/Main/Server/Main.server.luau"
			);

			expect(script?.content).toContain('print(Greeting("game"))');
		});

		it("should give the place a complete config that lists the common code and its own", async () => {
			const config = jsonOf(
				await plan(),
				"projects/game/default.rogen.json"
			);

			expect(config.name).toBe("game");
			expect(config.tree).toMatchObject({ $className: "DataModel" });
			expect(config.sourcePaths).toEqual(["../common/src", "src"]);
			expect(config.routes).toHaveProperty("Server");
			expect(config).not.toHaveProperty("servePort");
		});

		it("should put the sample world in the tree, with no files for it", async () => {
			const planned = await plan();

			expect(
				names(planned).filter((name) => name.startsWith("place"))
			).toEqual([]);
			expect(
				jsonOf(planned, "projects/game/default.rogen.json").tree
			).toMatchObject({
				Lighting: { $properties: { Brightness: 2 } },
				SoundService: {
					$properties: { RespectFilteringEnabled: true },
				},
				Workspace: {
					$properties: { FilteringEnabled: true },
					Baseplate: {
						$className: "Part",
						$properties: { Size: [512, 20, 512] },
					},
				},
			});
		});

		it("should say how to add a place, which is a copy of its folder", async () => {
			const edits = (await plan()).nextSteps.edits.join("\n");

			expect(edits).toContain("copy projects/game to projects/lobby");
			expect(edits).toContain(
				'set "name" in projects/lobby/default.rogen.json to "lobby"'
			);
			expect(edits).toContain(
				'add { "path": "projects/lobby" } to the folders in my-game.code-workspace'
			);
			expect(edits).toContain("rogen serve projects/lobby --port");
			expect(edits).toContain("selene.toml");
		});

		it("should write the empty source folders and no sample with --no-sample", async () => {
			const planned = await plan({ sample: false });

			expect(names(planned)).toEqual(
				expect.arrayContaining([
					"projects/common/src/.gitkeep",
					"projects/game/src/.gitkeep",
				])
			);
			expect(
				names(planned).filter((name) => name.endsWith(".luau"))
			).toEqual([]);
			expect(
				jsonOf(planned, "projects/game/default.rogen.json").tree
			).not.toHaveProperty("Workspace");
		});

		it("should write no config for the common code", async () => {
			const planned = await plan();

			expect(planned.configs).toEqual([
				"projects/game/default.rogen.json",
			]);
			expect(
				names(planned).filter((name) => name.endsWith(".rogen.json"))
			).toEqual(["projects/game/default.rogen.json"]);
		});

		it("should build the place and serve it by its folder", async () => {
			const planned = await plan();

			expect(planned.nextSteps.run).toEqual([
				"rogen serve projects/game",
			]);
			expect(planned.nextSteps.edits.join("\n")).toContain(
				"rogen write projects/game"
			);
		});

		it("should list the places in a workspace file named for the project", async () => {
			const planned = await plan();

			expect(jsonOf(planned, "my-game.code-workspace")).toEqual({
				folders: [
					{ path: "projects/common" },
					{ path: "projects/game" },
				],
				settings: {
					"luau-lsp.sourcemap.enabled": true,
					"luau-lsp.sourcemap.autogenerate": true,
					"luau-lsp.sourcemap.sourcemapFile": "sourcemap.json",
					"luau-lsp.sourcemap.generatorCommand":
						"rogen sourcemap --watch -o sourcemap.json",
					"stylua.searchParentDirectories": true,
				},
			});
			expect(planned.nextSteps.edits.join("\n")).toContain(
				"Open my-game.code-workspace in your editor, not the folder"
			);
		});

		it("should make the shared code read the sourcemap of the first place", async () => {
			const settings = jsonOf(
				await plan(),
				"projects/common/.vscode/settings.json"
			);

			expect(settings).toEqual({
				"luau-lsp.sourcemap.generatorCommand":
					"rogen sourcemap ../game --watch -o sourcemap.json",
			});
		});

		it("should write no editor settings at the root", async () => {
			expect(names(await plan())).not.toContain(".vscode/settings.json");
		});

		it("should leave a workspace file that is there alone, and say what to add", async () => {
			await put("my-game.code-workspace", "{}");

			const planned = await plan();

			expect(fileOf(planned, "my-game.code-workspace")).toBeUndefined();
			expect(planned.notes.join("\n")).toContain(
				'add "projects/common" and "projects/game" to its folders'
			);
			expect(planned.notes.join("\n")).toContain(
				'"rogen sourcemap --watch -o sourcemap.json"'
			);
		});

		it("should ignore the project files Rogen writes", async () => {
			const planned = await plan({ skipGit: undefined });

			expect(fileOf(planned, ".gitignore")?.content).toContain(
				"sourcemap.json\n*.project.json\n"
			);
		});

		it("should refuse a first place that has a config", async () => {
			await put("projects/game/default.rogen.json", "{}");

			const result = await serviceFor().plan({
				ask: false,
				choices: { places: true },
			});

			expect(result.isErr()).toBe(true);
		});

		it("should mount packages from the place folder", async () => {
			await put("package.json", '{"dependencies":{}}');
			await fileSystem.createDirectory(path.join(directory, "Packages"));

			const planned = await plan();

			expect(
				jsonOf(planned, "projects/game/default.rogen.json").tree
					.ReplicatedStorage
			).toMatchObject({ Packages: { $path: "../../Packages" } });
		});

		it("should say only a new roblox-ts project starts with places when the folder already is one", async () => {
			await put("tsconfig.json", "{}");
			await put("package.json", '{"devDependencies":{"roblox-ts":"1"}}');

			const result = await serviceFor().plan({
				ask: false,
				choices: { places: true, language: "roblox-ts", skipGit: true },
			});

			expect(result.isErr() && result.error.message).toContain(
				"--places starts a new roblox-ts project with places, and this folder already has one."
			);
		});

		describe("with a test runner", () => {
			const planned = async () => {
				await put(
					"package.json",
					'{"devDependencies":{"jest-lua":"1"}}'
				);
				return plan();
			};

			it("should write the release output beside the config", async () => {
				const result = await planned();

				expect(names(result)).not.toContain(
					"projects/game/dist.rogen.json"
				);
				expect(
					jsonOf(result, "projects/game/release.rogen.json")
				).toMatchObject({
					sourcePaths: ["../common/src", "src"],
					globIgnorePaths: ["**/*.spec.luau"],
				});
				expect(result.nextSteps.run).toEqual([
					"rogen serve projects/game",
				]);
			});
		});
	});

	describe("a new roblox-ts project", () => {
		beforeEach(() => {
			processes.installed.set("npm", "/bin/npm");
			processes.outputs.set("/bin/npm", {
				code: 0,
				stdout: "",
				stderr: "",
			});
		});

		const planned = (choices: InitChoices = {}) =>
			plan({ language: "roblox-ts", ...choices });

		it("should write each place as a folder under projects, with the shared code beside it", async () => {
			const result = await planned();

			expect(names(result)).toEqual(
				expect.arrayContaining([
					"projects/game/default.rogen.json",
					"projects/common/src/Greeter/shared/Greeting.ts",
					"projects/common/src/Greeter/server/Greeter.server.ts",
					"projects/common/src/Greeter/client/Greeter.client.ts",
					"projects/game/src/Main/server/Main.server.ts",
				])
			);
			expect(names(result)).not.toContain("game.rogen.json");
			expect(
				jsonOf(result, "projects/game/default.rogen.json").sourcePaths
			).toEqual(["../common/src", "src"]);
			expect(result.configs).toEqual([
				"projects/game/default.rogen.json",
			]);
		});

		it("should import the shared greeting by its path from the place's script", async () => {
			const result = await planned();

			expect(
				fileOf(result, "projects/game/src/Main/server/Main.server.ts")
					?.content
			).toContain('"../../../../common/src/Greeter/shared/Greeting"');
		});

		it("should sum up the code by the folders of the places", async () => {
			const result = await planned();

			expect(result.summary).toContainEqual({
				area: "Code",
				text: "projects/common/src, projects/game/src → server, client, shared; other files to ReplicatedStorage/shared",
			});
		});

		it("should put the sample world in the tree, with no files for it", async () => {
			const result = await planned();

			expect(
				names(result).filter((name) => name.startsWith("place"))
			).toEqual([]);
			expect(
				jsonOf(result, "projects/game/default.rogen.json").tree
			).toMatchObject({
				Lighting: { $properties: { Brightness: 2 } },
				Workspace: { Baseplate: { $className: "Part" } },
			});
		});

		it("should write no workspace file and no editor settings", async () => {
			const result = await planned();

			expect(names(result)).not.toContain(".vscode/settings.json");
			expect(
				names(result).filter((name) => name.endsWith(".code-workspace"))
			).toEqual([]);
			expect(result.nextSteps.edits.join("\n")).not.toContain("luau-lsp");
		});

		it("should compile each place from its own tsconfig, which holds every source path below one rootDir", async () => {
			const result = await planned();

			expect(jsonOf(result, "projects/game/tsconfig.json")).toMatchObject(
				{
					extends: "../../tsconfig.json",
					compilerOptions: {
						rootDir: "..",
						outDir: "../../out/game",
					},
					include: ["src", "../common/src"],
					rbxts: {
						rojo: "compiler.project.json",
						includePath: "../../include",
					},
				}
			);
			expect(jsonOf(result, "tsconfig.game.json")).toMatchObject({
				extends: "./projects/game/tsconfig.json",
				rbxts: { rojo: "projects/game/compiler.project.json" },
			});
		});

		it("should give the editor a root tsconfig that refers to each place", async () => {
			const root = jsonOf(await planned(), "tsconfig.json");

			expect(root.files).toEqual([]);
			expect(root.references).toEqual([{ path: "./projects/game" }]);
			expect(root.compilerOptions).toMatchObject({
				types: ["compiler-types", "types"],
			});
		});

		it("should mount the compiled place and the root's include and packages, from the place's folder", async () => {
			const config = jsonOf(
				await planned(),
				"projects/game/default.rogen.json"
			);

			expect(config.compiledPath).toBe("../../out/game");
			expect(config.tree.ReplicatedStorage.rbxts_include).toMatchObject({
				$path: "../../include",
				node_modules: {
					"@rbxts": { $path: "../../node_modules/@rbxts" },
				},
			});
		});

		it("should ignore what the places compile at the root", async () => {
			const ignored = fileOf(
				await planned({ skipGit: undefined }),
				".gitignore"
			)?.content;

			expect(ignored).toContain("/out\n");
			expect(ignored).not.toContain("projects/");
		});

		it("should clear the root tsconfig and src that create-roblox-ts wrote, and compile through the wrapper", async () => {
			const result = await planned();

			expect(result.scaffold?.replaces).toEqual([
				"default.project.json",
				"src",
				"tsconfig.json",
			]);
			expect(result.commands.map(({ args }) => args)).toContainEqual([
				"pkg",
				"set",
				"scripts.build=rbxtsc -p tsconfig.game.json",
				"scripts.watch=rbxtsc -w -p tsconfig.game.json",
			]);
			expect(result.nextSteps.run).toEqual([
				"npm run watch",
				"rogen serve projects/game",
			]);
		});

		it("should build the place by its folder", async () => {
			const result = await planned();

			expect(result.nextSteps.edits.join("\n")).toContain(
				"rogen write projects/game"
			);
		});

		it("should say how to add a place, which copies its folder and its tsconfig wrapper", async () => {
			const edits = (await planned()).nextSteps.edits.join("\n");

			expect(edits).toContain(
				'copy projects/game to projects/lobby, set "name" in projects/lobby/default.rogen.json to "lobby"'
			);
			expect(edits).toContain(
				'"compiledPath" of projects/lobby/default.rogen.json'
			);
			expect(edits).toContain(
				"Copy tsconfig.game.json to tsconfig.lobby.json"
			);
			expect(edits).toContain("rbxtsc -w -p tsconfig.lobby.json");
			expect(edits).toContain("rogen serve projects/lobby --port");
			expect(edits).not.toContain("workspace");
		});
	});

	describe("a folder named beside the places of a project", () => {
		it("should start a project in a folder of projects, as Rojo's init does", async () => {
			await put(
				"projects/game/default.rogen.json",
				JSON.stringify({ name: "game" })
			);
			await fileSystem.createDirectory(
				path.join(directory, "projects/common")
			);

			const planned = await plan({ places: false }, "projects/lobby");

			expect(planned.directory).toBe(
				path.join(directory, "projects/lobby")
			);
			expect(names(planned)).toContain("default.rogen.json");
		});

		it("should start a project in a new folder of a Luau project with places", async () => {
			await put(
				"game.rogen.json",
				JSON.stringify({
					name: "game",
					sourcePaths: ["src/common", "src/game"],
				})
			);
			await fileSystem.createDirectory(
				path.join(directory, "src/common")
			);

			const planned = await plan({ places: false }, "lobby");

			expect(planned.directory).toBe(path.join(directory, "lobby"));
			expect(names(planned)).toContain("default.rogen.json");
			expect(names(planned)).not.toContain("lobby.rogen.json");
		});
	});
});
