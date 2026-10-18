import path from "path";
import { jest } from "@jest/globals";
import { ResultError } from "../../../base/result.js";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { CoreInitService } from "../core-init-service.js";
import { InitPlan, InitWritten } from "../init-service.js";
import { RobloxTsStarter } from "../roblox-ts-starter.js";

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

	it("should ignore what create-roblox-ts would have, and each place's own with several", () => {
		expect(RobloxTsStarter.ignored(false)).toEqual([
			"/node_modules",
			"/out",
			"/include",
			"*.tsbuildinfo",
		]);
		expect(RobloxTsStarter.ignored(true)).toEqual([
			...RobloxTsStarter.ignored(false),
			"places/*/out",
			"places/*/include",
		]);
	});

	it("should point the build and watch scripts at the place", () => {
		expect(new RobloxTsStarter().scripts("places/game")).toMatchObject({
			file: "npm",
			args: [
				"pkg",
				"set",
				"scripts.build=rbxtsc -p places/game",
				"scripts.watch=rbxtsc -w -p places/game",
			],
		});
	});

	it("should have the root tsconfig check the shared code alone", () => {
		const { fileName, content } = new RobloxTsStarter().rootTsconfig(
			"places/shared/src"
		);

		expect(fileName).toBe("tsconfig.json");
		const tsconfig = JSON.parse(content);
		expect(tsconfig.compilerOptions).toMatchObject({
			rootDir: "places/shared/src",
			baseUrl: "places/shared/src",
		});
		expect(tsconfig.include).toEqual(["places/shared/src"]);
	});

	describe("place", () => {
		const place = new RobloxTsStarter().place(
			"places/game",
			"places/shared/src"
		);

		it("should compile its own code with the shared code into its own out folder", () => {
			const [file] = place.files;

			expect(file.fileName).toBe("places/game/tsconfig.json");
			const tsconfig = JSON.parse(file.content);
			expect(tsconfig.compilerOptions).toMatchObject({
				outDir: "out",
				rootDirs: ["src", "../shared/src"],
				baseUrl: ".",
				paths: { "*": ["src/*", "../shared/src/*"] },
				typeRoots: ["node_modules/@rbxts", "../../node_modules/@rbxts"],
				tsBuildInfoFile: "out/tsconfig.tsbuildinfo",
			});
			expect(tsconfig.compilerOptions).not.toHaveProperty("rootDir");
			expect(tsconfig).not.toHaveProperty("extends");
			expect(tsconfig.include).toEqual(["src", "../shared/src"]);
		});

		it("should name itself, sync from out and keep its runtime include in its own folder", () => {
			expect(place.config).toEqual({
				name: "game",
				syncPath: "out",
				tree: {
					ReplicatedStorage: {
						rbxts_include: { $path: { optional: "include" } },
					},
				},
			});
		});

		it("should reach the shared code of the root from any folder", () => {
			const [file] = new RobloxTsStarter().place(
				"places/arena",
				"src"
			).files;

			expect(JSON.parse(file.content).compilerOptions.rootDirs).toEqual([
				"src",
				"../../src",
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
		return new CoreInitService(
			fileSystem,
			new MockPromptService([], false),
			environmentService,
			new CoreToolchainService(fileSystem),
			new CoreConfigService(fileSystem, environmentService),
			processes
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

	const configOf = (planned: InitPlan, name = "rogen.json") =>
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
			).toContain('import { greeting } from "Greeter/shared/Greeting"');
		});

		it("should name the project, which roblox-ts needs, mount its runtime and sync from out", async () => {
			const config = configOf(await plan());

			expect(config.name).toBe("my-game");
			expect(config.syncPath).toBe("out");
			expect(config.tree.ReplicatedStorage.rbxts_include).toMatchObject({
				$path: "include",
				node_modules: { "@rbxts": { $path: "node_modules/@rbxts" } },
			});
		});

		it("should say to set the source path of tsconfig.json when it isn't src", async () => {
			const { nextSteps } = await plan({ sourcePaths: ["lib"] });

			expect(nextSteps.setup).toEqual([
				expect.stringContaining('Set "sourcePath" to "lib"'),
			]);
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
				"/node_modules\n/out\n/include\n*.tsbuildinfo\n"
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

	describe("with several places", () => {
		const several = () => plan({ places: true });

		it("should have the shared code and the game place, in TypeScript", async () => {
			const planned = await several();

			expect(planned.files.map(({ fileName }) => fileName)).toEqual(
				expect.arrayContaining([
					"places/shared/src/Greeter/shared/Greeting.ts",
					"places/game/src/Game/server/Game.server.ts",
				])
			);
		});

		it("should give the game place a tsconfig and a config that overrides the include", async () => {
			const planned = await several();

			expect(fileOf(planned, "places/game/tsconfig.json")).toBeDefined();
			expect(configOf(planned, "places/game/rogen.json")).toMatchObject({
				name: "game",
				syncPath: "out",
				servePort: expect.any(Number),
				tree: {
					ReplicatedStorage: {
						rbxts_include: { $path: { optional: "include" } },
					},
				},
			});
		});

		it("should leave the sync path to the places, so the root warns of no empty out folder", async () => {
			expect(configOf(await several())).not.toHaveProperty("syncPath");
		});

		it("should point the root tsconfig at the shared code", async () => {
			const root = JSON.parse(
				fileOf(await several(), "tsconfig.json")?.content ?? "{}"
			);

			expect(root.compilerOptions.rootDir).toBe("places/shared/src");
		});

		it("should point the package scripts at the game place after create-roblox-ts", async () => {
			const planned = await several();

			expect(planned.commands.map(({ command }) => command)).toContain(
				'npm pkg set "scripts.build=rbxtsc -p places/game" "scripts.watch=rbxtsc -w -p places/game"'
			);
		});

		it("should ignore each place's out and include", async () => {
			const planned = await plan({ places: true, skipGit: false });

			expect(fileOf(planned, ".gitignore")?.content).toContain(
				"places/*/out\nplaces/*/include\n"
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
						configThere = await present("rogen.json");
					return exec(file, args, options);
				}
			);

			const written = await serviceFor().write(planned, () => undefined);

			expect(written.isOk()).toBe(true);
			expect(configThere).toBe(false);
			expect(await present("rogen.json")).toBe(true);
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
			expect(await present("rogen.json")).toBe(false);
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
			expect(await present("rogen.json")).toBe(false);
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
			expect(await present("rogen.json")).toBe(false);
		});
	});
});
