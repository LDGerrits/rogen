import path from "path";
import { jest } from "@jest/globals";
import { ResultError, ok } from "../../../base/result.js";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { InitPlan, InitWritten } from "../init-service.js";
import { RobloxTsStarter } from "../roblox-ts-starter.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { initServiceOf } from "./init-of.js";
import { configServiceOf } from "../../config/__tests__/config-of.js";

const robloxTs = workspaceOf().languageFor("roblox-ts");
const luau = workspaceOf().languageFor("luau");
const directory = path.resolve("/mock/my-game");

describe("RobloxTsStarter", () => {
	it("should belong to roblox-ts alone", () => {
		expect(RobloxTsStarter.of(robloxTs)).toBeDefined();
		expect(RobloxTsStarter.of(luau)).toBeUndefined();
	});

	it("should run create-roblox-ts here without git or a build, and replace its sample and project file", () => {
		const { command, replaces } = new RobloxTsStarter().scaffold();

		expect(command.file).toBe("npm");
		expect(command.args).toEqual([
			"create",
			"roblox-ts@latest",
			"--",
			"game",
			"--dir",
			".",
			"--yes",
			"--git=false",
			"--skipBuild",
		]);
		expect(replaces).toEqual([
			"default.project.json",
			"src/client",
			"src/server",
			"src/shared",
		]);
	});

	it("should ignore the compiler output create-roblox-ts would have", () => {
		expect(RobloxTsStarter.ignored()).toEqual([
			"/out",
			"/include",
			"*.tsbuildinfo",
		]);
	});

	it("should ignore the compiler's own output folder", () => {
		expect(RobloxTsStarter.ignored("build")).toContain("/build");
	});

	it("should point the build and watch scripts at the place's tsconfig", () => {
		expect(new RobloxTsStarter().scripts("game")).toMatchObject({
			file: "npm",
			args: [
				"pkg",
				"set",
				"scripts.build=rbxtsc -p tsconfig.game.json",
				"scripts.watch=rbxtsc -w -p tsconfig.game.json",
			],
		});
	});

	it("should also replace the root tsconfig and src with several places", () => {
		expect(new RobloxTsStarter().scaffold(true).replaces).toEqual([
			"default.project.json",
			"src",
			"tsconfig.json",
		]);
	});

	describe("placesTsconfigs", () => {
		const tsconfigs = new Map(
			new RobloxTsStarter()
				.placesTsconfigs()
				.map(({ fileName, content }) => [fileName, JSON.parse(content)])
		);

		it("should write a root tsconfig that holds the options and refers to each place", () => {
			const root = tsconfigs.get("tsconfig.json");
			expect(root.compilerOptions).toMatchObject({
				rootDir: "src",
				typeRoots: ["node_modules/@rbxts"],
				types: ["compiler-types", "types"],
			});
			expect(root.files).toEqual([]);
			expect(root.references).toEqual([{ path: "./tsconfig.game.json" }]);
		});

		it("should compile the place with the common code below one rootDir into its own out folder", () => {
			const place = tsconfigs.get("tsconfig.game.json");
			expect(place).toMatchObject({
				extends: "./tsconfig.json",
				compilerOptions: {
					rootDir: "src",
					rootDirs: ["src/common", "src/game"],
					outDir: "out/game",
					composite: true,
				},
				include: ["src/common", "src/game"],
				rbxts: { rojo: "game.project.json" },
			});
		});

		it("should write nothing but the two tsconfigs", () => {
			expect([...tsconfigs.keys()].sort()).toEqual([
				"tsconfig.game.json",
				"tsconfig.json",
			]);
		});
	});
});

describe("a new roblox-ts project", () => {
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
		processes.installed.set("npm", "/bin/npm");
		processes.outputs.set("/bin/npm", { code: 0, stdout: "", stderr: "" });
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

	const plan = async (choices: object = {}) =>
		(
			await serviceFor().plan({
				choices: { language: "roblox-ts", skipGit: true, ...choices },
			})
		).unwrap() as InitPlan;

	const fileOf = (planned: InitPlan, name: string) =>
		planned.files.find(({ fileName }) => fileName === name);

	const configOf = (planned: InitPlan, name = "default.rogen.json") =>
		JSON.parse(fileOf(planned, name)?.content ?? "{}");

	describe("plan", () => {
		it("should start from create-roblox-ts, which it reports", async () => {
			const planned = await plan();

			expect(planned.scaffold?.command.command).toBe(
				"npm create roblox-ts@latest -- game --dir . --yes --git=false --skipBuild"
			);
			expect(planned.notes).toContain(
				"Starts from create-roblox-ts, which writes package.json, tsconfig.json and the compiler's settings."
			);
		});

		it("should write the sample in TypeScript, in the folders its routes are named after", async () => {
			const planned = await plan();

			expect(planned.files.map(({ fileName }) => fileName)).toEqual(
				expect.arrayContaining([
					"src/Greeter/shared/Greeting.ts",
					"src/Greeter/server/Greeter.server.ts",
					"src/Greeter/client/Greeter.client.ts",
				])
			);
			expect(
				fileOf(planned, "src/Greeter/server/Greeter.server.ts")?.content
			).toContain('import { greeting } from "../shared/Greeting"');
		});

		it("should name the project, which roblox-ts needs, mount its runtime and sync from out", async () => {
			const config = configOf(await plan());

			expect(config.name).toBe("my-game");
			expect(config.compiledPath).toBe("out");
			expect(config.tree.ReplicatedStorage.rbxts_include).toMatchObject({
				$path: "include",
				node_modules: { "@rbxts": { $path: "node_modules/@rbxts" } },
			});
		});

		it("should ask for nothing about packages", async () => {
			const planned = await plan();

			expect(
				planned.decided.map(({ question }) => question)
			).not.toContain("packages");
		});

		it("should say to run the package's watch script before serving", async () => {
			const { nextSteps } = await plan();

			expect(nextSteps.run).toEqual(["npm run watch", "rogen serve"]);
		});

		it("should ignore what create-roblox-ts would have ignored", async () => {
			const planned = await plan({ skipGit: false });

			expect(fileOf(planned, ".gitignore")?.content).toContain(
				"/out\n/include\n*.tsbuildinfo\n\n# Installed packages\n/node_modules\n"
			);
		});

		it("should run nothing when the folder has a package.json", async () => {
			await fileSystem.writeFile(
				path.join(directory, "package.json"),
				"{}"
			);

			const planned = await plan();

			expect(planned.scaffold).toBeUndefined();
			expect(planned.files.map(({ fileName }) => fileName)).not.toContain(
				"src/Greeter/shared/Greeting.ts"
			);
		});

		it("should run nothing when the folder has a tsconfig.json", async () => {
			await fileSystem.writeFile(
				path.join(directory, "tsconfig.json"),
				"{}"
			);

			expect((await plan()).scaffold).toBeUndefined();
		});

		it("should run nothing for a project file to lift", async () => {
			await fileSystem.writeFile(
				path.join(directory, "default.project.json"),
				'{"name":"x","tree":{"$className":"DataModel"}}'
			);

			expect((await plan()).scaffold).toBeUndefined();
		});

		it("should run nothing for a model or a plugin", async () => {
			expect((await plan({ kind: "model" })).scaffold).toBeUndefined();
		});

		it("should run nothing for Luau", async () => {
			expect((await plan({ language: "luau" })).scaffold).toBeUndefined();
		});

		it("should leave the source empty with --no-sample, still after create-roblox-ts", async () => {
			const planned = await plan({ sample: false });

			expect(planned.scaffold).toBeDefined();
			expect(planned.files.map(({ fileName }) => fileName)).not.toContain(
				"src/Greeter/shared/Greeting.ts"
			);
		});
	});

	describe("write", () => {
		const present = (file: string) =>
			fileSystem.exists(path.join(directory, file));

		it("should run create-roblox-ts before it writes any file", async () => {
			const planned = await plan();
			let configThere: boolean | undefined;
			const exec = processes.exec.bind(processes);
			jest.spyOn(processes, "exec").mockImplementation(
				async (file, args, options) => {
					if (file === "/bin/npm")
						configThere = await present("default.rogen.json");
					return exec(file, args, options);
				}
			);

			const written = await serviceFor().write(planned, () => undefined);

			expect(written.isOk()).toBe(true);
			expect(configThere).toBe(false);
			expect(await present("default.rogen.json")).toBe(true);
		});

		it("should remove what create-roblox-ts wrote and the sample replaces", async () => {
			const planned = await plan();
			const exec = processes.exec.bind(processes);
			jest.spyOn(processes, "exec").mockImplementation(
				async (file, args, options) => {
					if (file === "/bin/npm")
						for (const written of [
							"default.project.json",
							"src/client/main.client.ts",
							"src/server/main.server.ts",
							"src/shared/module.ts",
							"package.json",
						])
							await fileSystem.writeFile(
								path.join(directory, written),
								""
							);
					return exec(file, args, options);
				}
			);

			await serviceFor().write(planned, () => undefined);

			for (const file of [
				"default.project.json",
				"src/client",
				"src/server",
				"src/shared",
			])
				expect(await present(file)).toBe(false);
			expect(await present("package.json")).toBe(true);
			expect(await present("src/Greeter/shared/Greeting.ts")).toBe(true);
		});

		it("should report the tool first, as a command that ran", async () => {
			const written: InitWritten[] = [];

			await serviceFor().write(await plan(), (item) =>
				written.push(item)
			);

			expect(written[0]).toMatchObject({
				kind: "scaffold",
				scaffold: {
					command: { command: expect.stringContaining("npm create") },
				},
			});
		});

		it("should write nothing and run nothing else when create-roblox-ts fails, naming how to run it by hand", async () => {
			processes.outputs.set("/bin/npm", {
				code: 1,
				stdout: "",
				stderr: "npm error network\nmore",
			});
			const onWritten = jest.fn<(written: InitWritten) => void>();

			const result = await serviceFor().write(await plan(), onWritten);

			const { message } = (result as ResultError<Error>).error;
			expect(message).toContain("npm create roblox-ts@latest");
			expect(message).toContain("npm error network");
			expect(message).toContain("rogen init");
			expect(onWritten).not.toHaveBeenCalled();
			expect(await present("default.rogen.json")).toBe(false);
			expect(processes.execs.map(({ file }) => file)).toEqual([
				"/bin/rojo",
				"/bin/npm",
			]);
		});

		it("should fail when npm isn't installed", async () => {
			processes.installed.delete("npm");

			const result = await serviceFor().write(
				await plan(),
				() => undefined
			);

			expect((result as ResultError<Error>).error.message).toContain(
				"npm isn't installed"
			);
			expect(await present("default.rogen.json")).toBe(false);
		});

		describe("in a folder that isn't there yet", () => {
			const fresh = path.join(directory, "games", "fresh");

			const planFresh = async () =>
				(
					await serviceFor().plan({
						place: "games/fresh",
						choices: { language: "roblox-ts", skipGit: true },
					})
				).unwrap() as InitPlan;

			it("should make the folder before it runs create-roblox-ts there", async () => {
				const planned = await planFresh();
				let folderThere: boolean | undefined;
				const exec = processes.exec.bind(processes);
				jest.spyOn(processes, "exec").mockImplementation(
					async (file, args, options) => {
						if (file === "/bin/npm")
							folderThere = await fileSystem.exists(options.cwd);
						return exec(file, args, options);
					}
				);

				const written = await serviceFor().write(
					planned,
					() => undefined
				);

				expect(written.isOk()).toBe(true);
				expect(folderThere).toBe(true);
				expect(
					processes.execs.find(({ file }) => file === "/bin/npm")?.cwd
				).toBe(fresh);
			});

			it("should remove the folders it made when create-roblox-ts fails", async () => {
				const planned = await planFresh();
				const exec = processes.exec.bind(processes);
				jest.spyOn(processes, "exec").mockImplementation(
					async (file, args, options) => {
						if (file !== "/bin/npm")
							return exec(file, args, options);
						await fileSystem.writeFile(
							path.join(options.cwd, "package.json"),
							"{}"
						);
						return ok({ code: 1, stdout: "", stderr: "npm error" });
					}
				);

				const result = await serviceFor().write(
					planned,
					() => undefined
				);

				expect(result.isErr()).toBe(true);
				expect(
					await fileSystem.exists(path.join(directory, "games"))
				).toBe(false);
				expect(await fileSystem.exists(directory)).toBe(true);
				expect(result.isErr() && result.error).toMatchObject({
					hint: expect.stringMatching(
						/^Make .*games.*, run it there/
					),
				});
			});

			it("should make no folder in a dry run", async () => {
				await serviceFor().write(
					await planFresh(),
					() => undefined,
					true
				);

				expect(
					await fileSystem.exists(path.join(directory, "games"))
				).toBe(false);
			});
		});

		it("should run nothing in a dry run, and still report the tool", async () => {
			const written: InitWritten[] = [];

			await serviceFor().write(
				await plan(),
				(item) => written.push(item),
				true
			);

			expect(written[0]?.kind).toBe("scaffold");
			expect(processes.execs.map(({ file }) => file)).toEqual([
				"/bin/rojo",
			]);
			expect(await present("default.rogen.json")).toBe(false);
		});
	});
});
