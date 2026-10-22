import path from "path";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { CoreInitService } from "../core-init-service.js";
import { InitChoices, InitPlan } from "../init-service.js";

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
		return new CoreInitService(
			fileSystem,
			new MockPromptService([], false),
			environmentService,
			new CoreToolchainService(fileSystem),
			processes,
			undefined,
			new CoreConfigService(fileSystem, environmentService)
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
					"game.rogen.json",
					"src/common/Greeter/Shared/Greeting.luau",
					"src/game/Game/Server/Game.server.luau",
				])
			);
			expect(names(planned)).not.toContain("default.rogen.json");
			expect(
				names(planned).filter((name) => name.startsWith("places/"))
			).toEqual([]);
			expect(planned.directories).toEqual(["src/common", "src/game"]);
		});

		it("should give the place a complete config that lists the common code and its own", async () => {
			const config = jsonOf(await plan(), "game.rogen.json");

			expect(config.name).toBe("game");
			expect(config.tree).toMatchObject({ $className: "DataModel" });
			expect(config.rogen.sourcePaths).toEqual([
				"src/common",
				"src/game",
			]);
			expect(config.rogen.routes).toHaveProperty("Server");
			expect(config).not.toHaveProperty("servePort");
		});

		it("should keep the place's sample game in a folder of its own, which its tree mounts", async () => {
			const planned = await plan();

			expect(
				names(planned).filter((name) => name.startsWith("place/"))
			).toEqual([
				"place/game/Lighting/init.meta.json",
				"place/game/SoundService/init.meta.json",
				"place/game/Workspace/Baseplate.model.json",
				"place/game/Workspace/init.meta.json",
			]);
			expect(jsonOf(planned, "game.rogen.json").tree).toMatchObject({
				Lighting: { $path: "place/game/Lighting" },
				SoundService: { $path: "place/game/SoundService" },
				Workspace: { $path: "place/game/Workspace" },
			});
		});

		it("should say to copy the sample game with the config, and to mount the copy", async () => {
			const edits = (await plan()).nextSteps.edits.join("\n");

			expect(edits).toContain("place/game to place/lobby");
			expect(edits).toContain("copy place/game to place/lobby");
		});

		it("should say nothing of a sample game with --no-sample", async () => {
			const edits = (await plan({ sample: false })).nextSteps.edits.join(
				"\n"
			);

			expect(edits).toContain("copy game.rogen.json to lobby.rogen.json");
			expect(edits).not.toContain("place/game");
		});

		it("should write no config for the common code", async () => {
			const planned = await plan();

			expect(planned.configs).toEqual(["game.rogen.json"]);
			expect(
				names(planned).filter((name) => name.endsWith(".rogen.json"))
			).toEqual(["game.rogen.json"]);
		});

		it("should build the place and serve it by its name", async () => {
			const planned = await plan();

			expect(planned.nextSteps.run).toEqual(["rogen serve game"]);
			expect(planned.nextSteps.edits.join("\n")).toContain(
				"rogen build game"
			);
		});

		it("should make the editor read the sourcemap of the first place", async () => {
			const settings = jsonOf(await plan(), ".vscode/settings.json");

			expect(settings).toEqual({
				"luau-lsp.sourcemap.enabled": true,
				"luau-lsp.sourcemap.autogenerate": true,
				"luau-lsp.sourcemap.sourcemapFile": "sourcemap.json",
				"luau-lsp.sourcemap.generatorCommand":
					"rogen sourcemap game --watch -o sourcemap.json",
			});
		});

		it("should leave editor settings that are there alone, and say what to set", async () => {
			await put(".vscode/settings.json", "{}");

			const planned = await plan();

			expect(fileOf(planned, ".vscode/settings.json")).toBeUndefined();
			expect(planned.notes.join("\n")).toContain(
				'"rogen sourcemap game --watch -o sourcemap.json"'
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

		it("should say how to add a place, which is a copy of the config", async () => {
			const planned = await plan();

			expect(planned.nextSteps.edits.join("\n")).toContain(
				"copy game.rogen.json to lobby.rogen.json"
			);
			expect(planned.nextSteps.edits.join("\n")).toContain(
				"rogen serve lobby --port"
			);
		});

		it("should ignore the project files Rogen writes", async () => {
			const planned = await plan({ skipGit: false });

			expect(fileOf(planned, ".gitignore")?.content).toContain(
				"sourcemap.json\n*.project.json\n"
			);
		});

		it("should refuse a first place that has a config", async () => {
			await put("game.rogen.json", "{}");

			const result = await serviceFor().plan({
				ask: false,
				choices: { places: true },
			});

			expect(result.isErr()).toBe(true);
		});

		it("should refuse a source path, which every place lists in full", async () => {
			const result = await serviceFor().plan({
				ask: false,
				choices: { places: true, sourcePaths: ["lib"] },
			});

			expect(result.isErr()).toBe(true);
		});

		describe("with Darklua and a test runner", () => {
			const planned = async () => {
				await put(".darklua.json", "{}");
				await put(
					"package.json",
					'{"devDependencies":{"jest-lua":"1"}}'
				);
				return plan({ darklua: true });
			};

			it("should write the other outputs beside the config, named for the place", async () => {
				const result = await planned();

				expect(names(result)).toEqual(
					expect.arrayContaining([
						"game.dist.rogen.json",
						"game.release.rogen.json",
					])
				);
				expect(
					jsonOf(result, "game.dist.rogen.json").rogen
				).toMatchObject({
					sourcePaths: ["src/common", "src/game"],
					compiledPath: "dist",
				});
			});

			it("should process each source path into the layout dist reads, and serve the file", async () => {
				const result = await planned();

				expect(result.nextSteps.run).toEqual([
					"darklua process src/common dist/common --watch",
					"darklua process src/game dist/game --watch",
					"rogen serve game.dist.rogen.json",
				]);
			});

			it("should say how to add a place with its dist and release configs", async () => {
				const result = await planned();

				const edits = result.nextSteps.edits.join("\n");
				expect(edits).toContain(
					"Do the same for game.dist.rogen.json, and for game.release.rogen.json if there is one"
				);
				expect(edits).toContain(
					"darklua process src/lobby dist/lobby --watch"
				);
				expect(edits).toContain(
					"rogen serve lobby.dist.rogen.json --port"
				);
			});

			it("should write the Darklua config at the root, and ignore the processed folder there", async () => {
				const result = await plan({ darklua: true, skipGit: false });

				expect(names(result)).toContain(".darklua.json");
				expect(fileOf(result, ".gitignore")?.content).toContain(
					"\n/dist\n"
				);
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

		it("should keep each place in a folder of projects, beside the common code", async () => {
			const result = await planned();

			expect(names(result)).toEqual(
				expect.arrayContaining([
					"projects/game/default.rogen.json",
					"projects/common/src/Greeter/shared/Greeting.ts",
					"projects/game/src/Game/server/Game.server.ts",
				])
			);
			expect(
				names(result).filter((name) => name.startsWith("places/"))
			).toEqual([]);
			expect(
				jsonOf(result, "projects/game/default.rogen.json").rogen
					.sourcePaths
			).toEqual(["../common/src", "src"]);
		});

		it("should keep the place's sample game in its folder", async () => {
			const result = await planned();

			expect(
				names(result).filter((name) => name.includes("/place/"))
			).toEqual([
				"projects/game/place/Lighting/init.meta.json",
				"projects/game/place/SoundService/init.meta.json",
				"projects/game/place/Workspace/Baseplate.model.json",
				"projects/game/place/Workspace/init.meta.json",
			]);
			expect(
				jsonOf(result, "projects/game/default.rogen.json").tree.Lighting
			).toEqual({ $path: "place/Lighting" });
		});

		it("should write no workspace file", async () => {
			const result = await planned();

			expect(
				names(result).filter((name) => name.endsWith(".code-workspace"))
			).toEqual([]);
			expect(result.nextSteps.edits.join("\n")).not.toContain(
				"workspace"
			);
		});

		it("should give the common code a tsconfig for the editor and the place one for rbxtsc", async () => {
			const result = await planned();

			const common = jsonOf(result, "projects/common/tsconfig.json");
			expect(common.compilerOptions).toMatchObject({
				rootDir: "src",
				noEmit: true,
			});
			expect(
				jsonOf(result, "projects/game/tsconfig.json").compilerOptions
			).toMatchObject({
				outDir: "out",
				rootDirs: ["src", "../common/src"],
			});
			expect(names(result)).not.toContain("tsconfig.json");
		});

		it("should write no rogen config for the common code", async () => {
			const result = await planned();

			expect(
				names(result).filter((name) =>
					name.startsWith("projects/common/")
				)
			).not.toContain("projects/common/default.rogen.json");
			expect(result.configs).toEqual([
				"projects/game/default.rogen.json",
			]);
		});

		it("should read the compiled folder and mount the place's include and the root's packages", async () => {
			const config = jsonOf(
				await planned(),
				"projects/game/default.rogen.json"
			);

			expect(config.rogen.compiledPath).toBe("out");
			expect(config.tree.ReplicatedStorage.rbxts_include).toMatchObject({
				$path: { optional: "include" },
				node_modules: {
					"@rbxts": {
						$path: { optional: "../../node_modules/@rbxts" },
					},
				},
			});
		});

		it("should ignore what each place compiles", async () => {
			const result = await planned({ skipGit: false });

			expect(fileOf(result, ".gitignore")?.content).toContain(
				"projects/*/out\nprojects/*/include\n"
			);
		});

		it("should clear the root tsconfig and src that create-roblox-ts wrote, and compile the place", async () => {
			const result = await planned();

			expect(result.scaffold?.replaces).toEqual([
				"default.project.json",
				"src",
				"tsconfig.json",
			]);
			expect(result.nextSteps.run).toEqual([
				"npm run watch",
				"rogen serve projects/game",
			]);
		});

		it("should build the place by its folder", async () => {
			const result = await planned();

			expect(result.nextSteps.edits.join("\n")).toContain(
				"rogen build projects/game"
			);
		});

		it("should say how to add a place, which is a copy of its folder", async () => {
			const result = await planned();

			const edits = result.nextSteps.edits.join("\n");
			expect(edits).toContain(
				"copy projects/game/default.rogen.json, projects/game/tsconfig.json and projects/game/place into projects/lobby"
			);
			expect(edits).toContain("rbxtsc -w -p projects/lobby");
			expect(edits).toContain("rogen serve projects/lobby --port");
			expect(edits).not.toContain("rogen init");
		});

		it("should write the dist output and the Darklua config in the place's folder", async () => {
			const result = await planned({ darklua: true, skipGit: false });

			expect(names(result)).toEqual(
				expect.arrayContaining([
					"projects/game/dist.rogen.json",
					"projects/game/.darklua.json",
				])
			);
			expect(result.nextSteps.run).toEqual([
				"npm run watch",
				"cd projects/game && darklua process out dist --watch",
				"rogen serve projects/game/dist.rogen.json",
			]);
			expect(fileOf(result, ".gitignore")?.content).toContain(
				"/projects/*/dist\n"
			);
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
					rogen: { sourcePaths: ["src/common", "src/game"] },
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
