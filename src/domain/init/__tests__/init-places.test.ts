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
		it("should write a config per place at the root and the code below src", async () => {
			const planned = await plan();

			expect(names(planned)).toEqual(
				expect.arrayContaining([
					"lobby.rogen.json",
					"src/common/Greeter/Shared/Greeting.luau",
					"src/lobby/Welcome/Server/Welcome.server.luau",
				])
			);
			expect(names(planned)).not.toContain("default.rogen.json");
			expect(
				names(planned).filter((name) => name.startsWith("places/"))
			).toEqual([]);
			expect(planned.directories).toEqual(["src/common", "src/lobby"]);
		});

		it("should give the place a complete config that lists the common code and its own", async () => {
			const config = jsonOf(await plan(), "lobby.rogen.json");

			expect(config.name).toBe("lobby");
			expect(config.tree).toMatchObject({ $className: "DataModel" });
			expect(config.sourcePaths).toEqual(["src/common", "src/lobby"]);
			expect(config.routes).toHaveProperty("Server");
			expect(config).not.toHaveProperty("servePort");
		});

		it("should keep the place's sample world in its tree", async () => {
			const planned = await plan();

			expect(
				names(planned).filter((name) => name.startsWith("place/"))
			).toEqual([]);
			expect(jsonOf(planned, "lobby.rogen.json").tree).toMatchObject({
				Lighting: { $properties: { Technology: "Voxel" } },
				SoundService: {
					$properties: { RespectFilteringEnabled: true },
				},
				Workspace: {
					Baseplate: {
						$className: "Part",
						$properties: { Color: { Color3uint8: [99, 95, 99] } },
					},
				},
			});
		});

		it("should send the user to the docs rather than a README with --no-sample", async () => {
			const planned = await plan({ sample: false });

			expect(fileOf(planned, "README.md")).toBeUndefined();
			expect(planned.nextSteps.edits).toEqual([
				"Edit lobby.rogen.json, not lobby.project.json, which 'rogen write' replaces. Routes and the tree: https://rogen-roblox.vercel.app/docs/v2/multi-place",
			]);
		});

		it("should write no config for the common code", async () => {
			const planned = await plan();

			expect(planned.configs).toEqual(["lobby.rogen.json"]);
			expect(
				names(planned).filter((name) => name.endsWith(".rogen.json"))
			).toEqual(["lobby.rogen.json"]);
		});

		it("should build the place and serve it by its name", async () => {
			const planned = await plan();

			expect(planned.nextSteps.run).toEqual(["rogen serve lobby"]);
			expect(planned.nextSteps.edits).toEqual([
				"See README.md for routes, the tree and adding a place.",
			]);
		});

		it("should make the editor read the sourcemap of the first place", async () => {
			const settings = jsonOf(await plan(), ".vscode/settings.json");

			expect(settings).toEqual({
				"luau-lsp.sourcemap.enabled": true,
				"luau-lsp.sourcemap.autogenerate": true,
				"luau-lsp.sourcemap.sourcemapFile": "sourcemap.json",
				"luau-lsp.sourcemap.generatorCommand":
					"rogen sourcemap lobby --watch -o sourcemap.json",
			});
		});

		it("should leave editor settings that are there alone, and say what to set", async () => {
			await put(".vscode/settings.json", "{}");

			const planned = await plan();

			expect(fileOf(planned, ".vscode/settings.json")).toBeUndefined();
			expect(planned.notes.join("\n")).toContain(
				'"rogen sourcemap lobby --watch -o sourcemap.json"'
			);
		});

		it("should write no workspace file", async () => {
			const planned = await plan();

			expect(
				names(planned).filter((name) =>
					name.endsWith(".code-workspace")
				)
			).toEqual([]);
			expect(planned.nextSteps.edits.join("\n")).not.toContain(
				"workspace"
			);
		});

		it("should leave the README to say how to add a place, which is a copy of the config", async () => {
			const readme = fileOf(await plan(), "README.md")?.content;

			expect(readme).toContain(
				"Copy `lobby.rogen.json` to `match.rogen.json`"
			);
			expect(readme).toContain("rogen serve match --port");
			expect(readme).toContain("rogen write lobby");
		});

		it("should ignore the project files Rogen writes", async () => {
			const planned = await plan({ skipGit: undefined });

			expect(fileOf(planned, ".gitignore")?.content).toContain(
				"sourcemap.json\n*.project.json\n"
			);
		});

		it("should refuse a first place that has a config", async () => {
			await put("lobby.rogen.json", "{}");

			const result = await serviceFor().plan({
				ask: false,
				choices: { places: true },
			});

			expect(result.isErr()).toBe(true);
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

			it("should write the release output beside the config, named for the place", async () => {
				const result = await planned();

				expect(names(result)).not.toContain("lobby.dist.rogen.json");
				expect(
					jsonOf(result, "lobby.release.rogen.json")
				).toMatchObject({
					sourcePaths: ["src/common", "src/lobby"],
					globIgnorePaths: ["**/*.spec.luau"],
				});
				expect(result.nextSteps.run).toEqual(["rogen serve lobby"]);
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

		it("should write a config per place at the root and the code below src, as for Luau", async () => {
			const result = await planned();

			expect(names(result)).toEqual(
				expect.arrayContaining([
					"lobby.rogen.json",
					"src/common/Greeter/shared/Greeting.ts",
					"src/lobby/Welcome/server/Welcome.server.ts",
				])
			);
			expect(
				names(result).filter((name) => name.startsWith("projects/"))
			).toEqual([]);
			expect(jsonOf(result, "lobby.rogen.json").sourcePaths).toEqual([
				"src/common",
				"src/lobby",
			]);
			expect(result.configs).toEqual(["lobby.rogen.json"]);
		});

		it("should sum up the code by the folders of the places", async () => {
			const result = await planned();

			expect(result.summary).toContainEqual({
				area: "Code",
				text: "src/common, src/lobby → server, client, shared; other files to ReplicatedStorage/shared",
			});
		});

		it("should keep the place's sample world in its tree", async () => {
			const result = await planned();

			expect(
				names(result).filter((name) => name.startsWith("place/"))
			).toEqual([]);
			expect(jsonOf(result, "lobby.rogen.json").tree).toMatchObject({
				Lighting: { $properties: { Technology: "Voxel" } },
				Workspace: { Baseplate: { $className: "Part" } },
			});
		});

		it("should write no editor settings for luau-lsp", async () => {
			const result = await planned();

			expect(names(result)).not.toContain(".vscode/settings.json");
			expect(result.nextSteps.edits.join("\n")).not.toContain("luau-lsp");
		});

		it("should compile each place from a tsconfig whose rootDir holds every source path", async () => {
			const result = await planned();

			const place = jsonOf(result, "tsconfig.lobby.json");
			expect(place).toMatchObject({
				extends: "./tsconfig.json",
				compilerOptions: {
					rootDir: "src",
					outDir: "out/lobby",
					composite: true,
				},
				include: ["src/common", "src/lobby"],
				rbxts: { rojo: "lobby.project.json" },
			});
		});

		it("should give the editor a root tsconfig that refers to each place", async () => {
			const root = jsonOf(await planned(), "tsconfig.json");

			expect(root.files).toEqual([]);
			expect(root.references).toEqual([
				{ path: "./tsconfig.lobby.json" },
			]);
			expect(root.compilerOptions).toMatchObject({
				rootDir: "src",
				types: ["compiler-types", "types"],
			});
		});

		it("should mount the compiled place and the root's include and packages", async () => {
			const config = jsonOf(await planned(), "lobby.rogen.json");

			expect(config.compiledPath).toBe("out/lobby");
			expect(config.tree.ReplicatedStorage.rbxts_include).toMatchObject({
				$path: "include",
				node_modules: {
					"@rbxts": { $path: "node_modules/@rbxts" },
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

		it("should clear the root tsconfig and src that create-roblox-ts wrote, and compile the place", async () => {
			const result = await planned();

			expect(result.scaffold?.replaces).toEqual([
				"default.project.json",
				"src",
				"tsconfig.json",
			]);
			expect(result.commands.map(({ args }) => args)).toContainEqual([
				"pkg",
				"set",
				"scripts.build=rbxtsc -p tsconfig.lobby.json",
				"scripts.watch=rbxtsc -w -p tsconfig.lobby.json",
			]);
			expect(result.nextSteps.run).toEqual([
				"npm run watch",
				"rogen serve lobby",
			]);
		});

		it("should send the user to the README for the rest", async () => {
			const result = await planned();

			expect(result.nextSteps.edits).toEqual([
				"See README.md for routes, the tree and adding a place.",
			]);
		});

		it("should leave the README to say how to add a place, which copies its config and its tsconfig", async () => {
			const readme = fileOf(await planned(), "README.md")?.content;

			expect(readme).toContain(
				"Copy `lobby.rogen.json` to `match.rogen.json` and `tsconfig.lobby.json` to `tsconfig.match.json`"
			);
			expect(readme).toContain("rbxtsc -w -p tsconfig.match.json");
			expect(readme).toContain("rogen serve match --port");
			expect(readme).toContain("rogen write lobby");
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
