import path from "path";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
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
			new CoreConfigService(fileSystem, environmentService),
			processes
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

	const write = async (planned: InitPlan) => {
		(await serviceFor().write(planned, () => undefined)).unwrap();
	};

	const put = (file: string, content = "") =>
		fileSystem.writeFile(path.join(directory, file), content);

	const fileOf = (planned: InitPlan, name: string) =>
		planned.files.find(({ fileName }) => fileName === name);

	const jsonOf = (planned: InitPlan, name: string) =>
		JSON.parse(fileOf(planned, name)?.content ?? "{}");

	const names = (planned: InitPlan) =>
		planned.files.map(({ fileName }) => fileName);

	describe("a new project", () => {
		it("should write nothing at the root and a complete config in the first place", async () => {
			const planned = await plan();

			expect(names(planned)).toEqual(
				expect.arrayContaining([
					"places/game/default.rogen.json",
					"places/shared/src/Greeter/Shared/Greeting.luau",
					"places/game/src/Game/Server/Game.server.luau",
				])
			);
			expect(names(planned)).not.toContain("default.rogen.json");
			expect(names(planned)).not.toContain(
				"places/shared/default.rogen.json"
			);
			const config = jsonOf(planned, "places/game/default.rogen.json");
			expect(config.name).toBe("game");
			expect(config.rogen.sourcePaths).toEqual(["../shared/src", "src"]);
			expect(config.rogen.routes).toHaveProperty("Server");
			expect(config).not.toHaveProperty("servePort");
		});

		it("should build the place and serve it by its folder", async () => {
			const planned = await plan();

			expect(planned.configs).toEqual(["places/game/default.rogen.json"]);
			expect(planned.nextSteps.run).toEqual(["rogen serve places/game"]);
			expect(planned.nextSteps.edits.join("\n")).toContain(
				"rogen serve places/lobby --port"
			);
		});

		it("should list each place and the shared code in the editor workspace", async () => {
			const workspace = jsonOf(await plan(), "my-game.code-workspace");

			expect(workspace.folders).toEqual([
				{ path: "." },
				{ path: "places/game" },
				{ path: "places/shared" },
			]);
		});

		it("should ignore the project files Rogen writes", async () => {
			const planned = await plan({ skipGit: false });

			expect(fileOf(planned, ".gitignore")?.content).toContain(
				"sourcemap.json\n*.project.json\n"
			);
		});

		it("should refuse a first place that has a config", async () => {
			await put("places/game/default.rogen.json", "{}");

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

			it("should write a dist file and a Darklua config in the place", async () => {
				const result = await planned();

				expect(names(result)).toEqual(
					expect.arrayContaining([
						"places/game/dist.rogen.json",
						"places/game/.darklua.json",
					])
				);
				expect(
					jsonOf(result, "places/game/dist.rogen.json").rogen
				).toMatchObject({
					sourcePaths: ["../shared/src", "src"],
					compiledPath: "dist",
				});
			});

			it("should process each source path into the layout dist reads, and serve the file", async () => {
				const result = await planned();

				expect(result.nextSteps.run).toEqual([
					"cd places/game && darklua process ../shared/src dist/shared/src --watch",
					"cd places/game && darklua process src dist/game/src --watch",
					"rogen serve places/game/dist.rogen.json",
				]);
			});

			it("should ignore the processed folder of every place", async () => {
				const result = await plan({ darklua: true, skipGit: false });

				expect(fileOf(result, ".gitignore")?.content).toContain(
					"/places/*/dist\n"
				);
			});
		});

		describe("with roblox-ts", () => {
			beforeEach(() => {
				processes.installed.set("npm", "/bin/npm");
				processes.outputs.set("/bin/npm", {
					code: 0,
					stdout: "",
					stderr: "",
				});
			});

			it("should give the shared code a tsconfig for the editor and the place one for rbxtsc", async () => {
				const planned = await plan({ language: "roblox-ts" });

				const shared = jsonOf(planned, "places/shared/tsconfig.json");
				expect(shared.compilerOptions).toMatchObject({
					rootDir: "src",
					noEmit: true,
				});
				expect(
					jsonOf(planned, "places/game/tsconfig.json").compilerOptions
				).toMatchObject({
					outDir: "out",
					rootDirs: ["src", "../shared/src"],
				});
				expect(names(planned)).not.toContain("tsconfig.json");
			});

			it("should read the compiled folder and mount the place's include and the root's packages", async () => {
				const config = jsonOf(
					await plan({ language: "roblox-ts" }),
					"places/game/default.rogen.json"
				);

				expect(config.rogen.compiledPath).toBe("out");
				expect(
					config.tree.ReplicatedStorage.rbxts_include
				).toMatchObject({
					$path: { optional: "include" },
					node_modules: {
						"@rbxts": {
							$path: { optional: "../../node_modules/@rbxts" },
						},
					},
				});
			});

			it("should ignore what each place compiles", async () => {
				const planned = await plan({
					language: "roblox-ts",
					skipGit: false,
				});

				expect(fileOf(planned, ".gitignore")?.content).toContain(
					"places/*/out\nplaces/*/include\n"
				);
			});

			it("should clear the root tsconfig and src that create-roblox-ts wrote, and compile the place", async () => {
				const planned = await plan({ language: "roblox-ts" });

				expect(planned.scaffold?.replaces).toEqual([
					"default.project.json",
					"src",
					"tsconfig.json",
				]);
				expect(planned.nextSteps.run).toEqual([
					"npm run watch",
					"rogen serve places/game",
				]);
			});
		});
	});

	describe("a place added to places", () => {
		beforeEach(async () => {
			await write(await plan());
		});

		it("should copy the routes, the tree and the shared source path of the first place", async () => {
			const first = JSON.parse(
				await fileSystem.readFile(
					path.join(directory, "places/game/default.rogen.json")
				)
			);

			const planned = await plan({}, "places/lobby");

			expect(planned.directory).toBe(directory);
			expect(planned.configs).toEqual([
				"places/lobby/default.rogen.json",
			]);
			expect(jsonOf(planned, "places/lobby/default.rogen.json")).toEqual({
				$schema: first.$schema,
				name: "lobby",
				tree: first.tree,
				rogen: {
					sourcePaths: ["../shared/src", "src"],
					routes: first.rogen.routes,
				},
			});
			expect(planned.directories).toEqual(["places/lobby/src"]);
		});

		it("should write no port", async () => {
			const planned = await plan({}, "places/lobby");

			expect(
				fileOf(planned, "places/lobby/default.rogen.json")?.content
			).not.toMatch(/servePort/);
		});

		it("should append the folder to the workspace that is there", async () => {
			const planned = await plan({}, "places/lobby");

			const workspace = fileOf(planned, "my-game.code-workspace");
			expect(workspace?.addition).toBe("places/lobby");
			expect(JSON.parse(workspace?.content ?? "{}").folders).toEqual([
				{ path: "." },
				{ path: "places/game" },
				{ path: "places/lobby" },
				{ path: "places/shared" },
			]);
		});

		it("should make no workspace when there is none", async () => {
			await fileSystem.delete(
				path.join(directory, "my-game.code-workspace")
			);

			const planned = await plan({}, "places/lobby");

			expect(
				names(planned).filter((name) =>
					name.endsWith(".code-workspace")
				)
			).toEqual([]);
		});

		it("should leave the shared code out when there is none", async () => {
			await fileSystem.delete(
				path.join(directory, "places/shared"),
				true
			);

			const planned = await plan({}, "places/lobby");

			expect(
				jsonOf(planned, "places/lobby/default.rogen.json").rogen
					.sourcePaths
			).toEqual(["src"]);
		});

		it("should skip a model whose config does not parse", async () => {
			await put("places/arena/default.rogen.json", "{ broken");

			const planned = await plan({}, "places/lobby");

			expect(
				jsonOf(planned, "places/lobby/default.rogen.json").rogen.routes
			).toHaveProperty("Server");
		});

		it("should serve it by its folder and say a second place takes a port", async () => {
			const planned = await plan({}, "places/lobby");

			expect(planned.nextSteps.run).toEqual(["rogen serve places/lobby"]);
			expect(planned.nextSteps.edits.join("\n")).toContain("--port");
		});

		it("should copy the Darklua and release files of the first place", async () => {
			await put(
				"places/game/dist.rogen.json",
				JSON.stringify({ rogen: { compiledPath: "dist" } })
			);
			await put(
				"places/game/release.rogen.json",
				JSON.stringify({
					rogen: { compiledPath: "dist" },
					globIgnorePaths: ["**/*.spec.luau"],
				})
			);
			await put("places/game/.darklua.json", "{}");

			const planned = await plan({}, "places/lobby");

			expect(names(planned)).toEqual(
				expect.arrayContaining([
					"places/lobby/default.rogen.json",
					"places/lobby/dist.rogen.json",
					"places/lobby/release.rogen.json",
					"places/lobby/.darklua.json",
				])
			);
			expect(
				jsonOf(planned, "places/lobby/release.rogen.json")
			).toMatchObject({
				name: "lobby",
				globIgnorePaths: ["**/*.spec.luau"],
				rogen: { compiledPath: "dist" },
			});
			expect(planned.nextSteps.run).toEqual([
				"cd places/lobby && darklua process ../shared/src dist/shared/src --watch",
				"cd places/lobby && darklua process src dist/lobby/src --watch",
				"rogen serve places/lobby/dist.rogen.json",
			]);
		});

		it("should copy the tsconfig of a roblox-ts place and compile it", async () => {
			await put(
				"places/game/tsconfig.json",
				'{"compilerOptions":{"outDir":"out"}}'
			);

			const planned = await plan({}, "places/lobby");

			expect(fileOf(planned, "places/lobby/tsconfig.json")?.content).toBe(
				'{"compilerOptions":{"outDir":"out"}}'
			);
			expect(planned.nextSteps.run).toEqual([
				"rbxtsc -w -p places/lobby",
				"rogen serve places/lobby",
			]);
		});

		it("should start an ordinary project when no place has a config to copy", async () => {
			await fileSystem.delete(path.join(directory, "places"), true);

			const planned = await plan({ places: false }, "places/lobby");

			expect(planned.directory).toBe(
				path.join(directory, "places/lobby")
			);
			expect(names(planned)).toContain("default.rogen.json");
		});
	});
});
