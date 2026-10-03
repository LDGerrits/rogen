import { jest } from "@jest/globals";
import path from "path";
import "../init-command.js";
import { DisposableStore } from "../../../base/disposable.js";
import { CancelledError } from "../../../base/errors.js";
import { ResultError } from "../../../base/result.js";
import { CoreToolchainService } from "../../../domain/toolchain/core-toolchain-service.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { CoreInitService } from "../../../domain/init/core-init-service.js";
import { InitService } from "../../../domain/init/init-service.js";
import { SCHEMA_URL } from "../../../domain/config/config.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { configSchema } from "../../../domain/config/config-schema.js";
import { ConfigFileReader } from "../../../platform/config/config-file.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import { LogService } from "../../../platform/log/log-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { PromptService } from "../../../platform/prompt/prompt-service.js";
import {
	ACCEPT_DEFAULT,
	CANCEL,
	MockPromptService,
	ScriptedAnswer,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { ParsedArgs, parseArgs } from "../../../platform/environment/args.js";
import {
	CommandRegistry,
	Extensions,
} from "../../../platform/commands/commands.js";
import { Registry } from "../../../platform/registry/registry.js";

const LUAU_ROUTES = {
	Server: "ServerScriptService",
	Client: "StarterPlayer/StarterPlayerScripts",
	Shared: "ReplicatedStorage/Shared",
	"*": "ReplicatedStorage/Shared",
};
const ROBLOX_TS_ROUTES = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	shared: "ReplicatedStorage/shared",
	"*": "ReplicatedStorage/shared",
};

describe("init command", () => {
	const cwd = path.resolve("/mock/my-game");
	let memFs: MemoryFileSystemService;
	let store: DisposableStore;

	const runInit = (
		names: string[] = [],
		promptService: PromptService = new MockPromptService([], false),
		logService: LogService = new NullLogService(),
		options: Omit<ParsedArgs, "_"> = {}
	) => {
		const environment = new NativeEnvironmentService(
			{ _: ["init", ...names], ...options },
			cwd
		);
		const services = new ServiceCollection();
		services.set(EnvironmentService, environment);
		services.set(
			InitService,
			new CoreInitService(
				memFs,
				promptService,
				environment,
				new CoreToolchainService(memFs),
				new CoreConfigService(memFs, environment)
			)
		);
		services.set(LogService, logService);
		services.set(PromptService, promptService);

		return new CoreCommandService(services, logService).executeCommand(
			"init",
			environment.args
		);
	};

	const write = (file: string, content = "") =>
		memFs.writeFile(path.join(cwd, file), content);
	const read = (file: string) => memFs.readFile(path.join(cwd, file));
	const readJson = async (file: string) => JSON.parse(await read(file));
	const exists = (file: string) => memFs.exists(path.join(cwd, file));
	const errorMessage = (result: Awaited<ReturnType<typeof runInit>>) =>
		(result as ResultError<Error>).error.message;
	const diagnosticsOf = (result: Awaited<ReturnType<typeof runInit>>) =>
		((result as ResultError<Error>).error as DiagnosticsError).diagnostics;

	beforeEach(async () => {
		memFs = new MemoryFileSystemService();
		store = new DisposableStore();
		await memFs.createDirectory(cwd);
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("--json", () => {
		const runJson = async (names: string[] = []) => {
			const logService = new MockLogService();
			const result = await runInit(
				names,
				new MockPromptService([], false),
				logService,
				{ json: true }
			);
			return { result, logService };
		};

		it("should print only the files written and the next steps as one document", async () => {
			await write("tsconfig.json", "{}");
			await runInit();

			const { result, logService } = await runJson(["lobby"]);

			expect(result.isOk()).toBe(true);
			expect(logService.entries.map(({ kind }) => kind)).toEqual([
				"print",
			]);
			expect(JSON.parse(logService.entries[0].text)).toEqual({
				files: [
					path.join(cwd, "lobby.rogen.json"),
					path.join(cwd, "tsconfig.lobby.json"),
				],
				notes: [],
				nextSteps: {
					setup: [
						'Add "include": ["src"] to tsconfig.json, so its own build leaves out the place folders.',
					],
					run: [
						"rbxtsc -w -p tsconfig.lobby.json --rojo lobby.project.json",
						"rogen watch lobby",
						"rojo serve lobby.project.json",
					],
					darklua: [],
					edits: [
						'Add tags under "tags" in lobby.rogen.json to swap in variants like Analytics.mock.ts.',
					],
				},
			});
			expect(await exists("tsconfig.lobby.json")).toBe(true);
		});

		it("should print nothing and return the failure", async () => {
			await write("default.rogen.json", "{}");

			const { result, logService } = await runJson();

			expect(diagnosticsOf(result)).toMatchObject([
				{ code: "init.configExists" },
			]);
			expect(logService.entries).toEqual([]);
		});

		it("should name the files it wrote before a write failed", async () => {
			await write("tsconfig.json", "{}");
			await runInit();
			const writeFile = memFs.writeFile.bind(memFs);
			jest.spyOn(memFs, "writeFile").mockImplementation(
				async (file, content) => {
					if (file.endsWith("tsconfig.lobby.json"))
						throw new Error("disk full");
					return writeFile(file, content);
				}
			);

			const { result, logService } = await runJson(["lobby"]);

			expect(result.isErr()).toBe(true);
			expect(JSON.parse(logService.entries[0].text)).toEqual({
				files: [path.join(cwd, "lobby.rogen.json")],
				error: "Failed to write tsconfig.lobby.json: disk full",
			});
		});

		it("should be accepted on the command line", () => {
			const registry = Registry.as<CommandRegistry>(Extensions.Commands);
			const parsed = parseArgs(
				["init", "--json"],
				(command) => registry.getOptions(command),
				(command) => registry.getCommand(command) !== undefined
			);

			expect(parsed.unwrap().options.json).toBe(true);
		});
	});

	describe("output", () => {
		it("should open with a header, list each file written and close with a result", async () => {
			const logService = new MockLogService();

			await runInit([], new MockPromptService([], false), logService);

			expect(logService.lines).toEqual([
				"intro: rogen init",
				"success: Created default.rogen.json.",
				"step: Next steps",
				"info: Run each in its own terminal:",
				"info:   rogen watch",
				"info:   rojo serve default.project.json",
				'info: Add your own routes under "routes" in default.rogen.json.',
				'info: Add tags under "tags" in default.rogen.json to swap in variants like Analytics.mock.luau.',
				"outro: Wrote 1 file.",
			]);
		});

		it("should print nothing after the header when the config already exists", async () => {
			await write("default.rogen.json", "{}");
			const logService = new MockLogService();

			const result = await runInit(
				[],
				new MockPromptService([], false),
				logService
			);

			expect(result.isErr()).toBe(true);
			expect(logService.lines).toEqual(["intro: rogen init"]);
		});
	});

	describe("language and darklua", () => {
		it("should write a plain config when no toolchain is found", async () => {
			const result = await runInit();

			expect(result.isOk()).toBe(true);
			const config = await readJson("default.rogen.json");
			expect(config.rootDirs).toEqual(["src"]);
			expect(config.routes).toEqual(LUAU_ROUTES);
			expect(config.syncDir).toBeUndefined();
			expect(config.template).toBeUndefined();
			expect(await exists("template.project.json")).toBe(false);
		});

		it("should write lowercase route keys for roblox-ts", async () => {
			await write("tsconfig.json", "{}");

			await runInit();

			expect((await readJson("default.rogen.json")).routes).toEqual(
				ROBLOX_TS_ROUTES
			);
		});

		it("should use the tsconfig outDir as syncDir for roblox-ts", async () => {
			await write(
				"tsconfig.json",
				JSON.stringify({ compilerOptions: { outDir: "build" } })
			);

			await runInit();

			expect((await readJson("default.rogen.json")).syncDir).toBe(
				"build"
			);
		});

		it("should fall back to out when tsconfig has no outDir", async () => {
			await write("tsconfig.json", "{}");

			await runInit();

			expect((await readJson("default.rogen.json")).syncDir).toBe("out");
		});

		it("should write one config for roblox-ts", async () => {
			await write("tsconfig.json", "{}");

			await runInit();

			expect(await exists("sync.rogen.json")).toBe(false);
		});

		it("should write one config synced from dist for roblox-ts with darklua", async () => {
			await write("tsconfig.json", "{}");
			await write(".darklua.json");

			await runInit();

			expect(await exists("sync.rogen.json")).toBe(false);
			expect((await readJson("default.rogen.json")).syncDir).toBe("dist");
		});

		it("should write a source-rooted default and a sync config for darklua", async () => {
			await write(".darklua.json");

			await runInit();

			const source = await readJson("default.rogen.json");
			const synced = await readJson("sync.rogen.json");
			expect(source.syncDir).toBeUndefined();
			expect(source.routes).toEqual(LUAU_ROUTES);
			expect(synced.extends).toBe("./default.rogen.json");
			expect(synced.syncDir).toBe("dist");
			expect(synced.routes).toBeUndefined();
		});

		it("should write <name> and <name>-sync for a named darklua config", async () => {
			await write(".darklua.json5");

			await runInit(["lobby"]);

			expect((await readJson("lobby-sync.rogen.json")).extends).toBe(
				"./lobby.rogen.json"
			);
			expect(await exists("lobby.rogen.json")).toBe(true);
			expect(await exists("default.rogen.json")).toBe(false);
			expect(await exists("sync.rogen.json")).toBe(false);
		});
	});

	describe("package mounts", () => {
		it.each([
			["wally.toml", "Packages", "Packages"],
			["pesde.toml", "roblox_packages", "roblox_packages"],
		])(
			"should write a template with mounts when %s is found",
			async (file, dir, mounted) => {
				await write(file);
				if (dir) await memFs.createDirectory(path.join(cwd, dir));

				await runInit();

				expect((await readJson("default.rogen.json")).template).toBe(
					"template.project.json"
				);
				const template = await readJson("template.project.json");
				expect(template.name).toBe("my-game");
				expect(template.tree.$className).toBe("DataModel");
				expect(JSON.stringify(template.tree)).toContain(mounted);
			}
		);

		it("should mount include and @rbxts as optional for roblox-ts", async () => {
			await write("tsconfig.json", "{}");

			await runInit();

			const template = await readJson("template.project.json");
			expect(template.tree.ReplicatedStorage.rbxts_include).toEqual({
				$path: { optional: "include" },
				node_modules: {
					$className: "Folder",
					"@rbxts": { $path: { optional: "node_modules/@rbxts" } },
				},
			});
		});

		it("should not write a template without mounts", async () => {
			await runInit();

			expect(await exists("template.project.json")).toBe(false);
			expect(
				(await readJson("default.rogen.json")).template
			).toBeUndefined();
		});

		it("should reference an existing template and leave it untouched", async () => {
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));
			await write("template.project.json", '{"name":"mine"}');

			await runInit(["lobby"]);

			expect(await read("template.project.json")).toBe('{"name":"mine"}');
			expect((await readJson("lobby.rogen.json")).template).toBe(
				"template.project.json"
			);
		});

		it("should let a later place inherit default's template through extends", async () => {
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();
			const template = await read("template.project.json");
			await runInit(["lobby"]);

			expect(await read("template.project.json")).toBe(template);
			const lobby = await readJson("lobby.rogen.json");
			expect(lobby.extends).toBe("./default.rogen.json");
			expect(lobby.template).toBeUndefined();
		});

		it("should put the template in the darklua source-rooted config only", async () => {
			await write(".darklua.json");
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();

			expect((await readJson("default.rogen.json")).template).toBe(
				"template.project.json"
			);
			expect(
				(await readJson("sync.rogen.json")).template
			).toBeUndefined();
		});
	});

	describe("written files", () => {
		it("should write strict JSON that parses under the config schema", async () => {
			await write(".darklua.json");
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();

			for (const file of ["default.rogen.json", "sync.rogen.json"]) {
				const text = await read(file);
				expect(() => JSON.parse(text)).not.toThrow();
				expect(
					(
						await new ConfigFileReader(memFs, configSchema).read(
							path.join(cwd, file)
						)
					).isOk()
				).toBe(true);
			}
		});

		it("should write fields in pipeline order", async () => {
			await write("tsconfig.json", "{}");
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();

			expect(Object.keys(await readJson("default.rogen.json"))).toEqual([
				"$schema",
				"rootDirs",
				"routes",
				"template",
				"syncDir",
			]);
		});

		it("should never write into .vscode", async () => {
			await write("tsconfig.json", "{}");
			await write(".darklua.json");

			await runInit();

			expect(await exists(".vscode")).toBe(false);
		});
	});

	describe("names", () => {
		it("should write the detected root dir without a terminal", async () => {
			await write("lib/Main.luau");

			await runInit();

			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"lib",
			]);
		});

		it("should write default.rogen.json for a bare init", async () => {
			await runInit();

			expect(await exists("default.rogen.json")).toBe(true);
		});

		it("should write <name>.rogen.json for a named init", async () => {
			await runInit(["lobby"]);

			expect(await exists("lobby.rogen.json")).toBe(true);
			expect(await exists("default.rogen.json")).toBe(false);
		});

		it.each(["a/b", "..\\x", "..", "."])(
			"should reject the name %s",
			async (name) => {
				const result = await runInit([name]);

				expect(result.isErr()).toBe(true);
				expect(errorMessage(result)).toContain(
					"not a valid config name"
				);
			}
		);

		it("should reject more than one name", async () => {
			const result = await runInit(["a", "b"]);

			expect(result.isErr()).toBe(true);
			expect(await exists("a.rogen.json")).toBe(false);
		});
	});

	describe("interactive", () => {
		it("should write what plain init writes when every default is accepted", async () => {
			await write("tsconfig.json", "{}");
			await write("Packages/x.luau");
			await write("wally.toml");
			const prompts = new MockPromptService(
				Array(9).fill(ACCEPT_DEFAULT)
			);

			const result = await runInit([], prompts);
			const interactive = await readJson("default.rogen.json");
			const interactiveTemplate = await readJson("template.project.json");
			await memFs.delete(path.join(cwd, "default.rogen.json"));
			await memFs.delete(path.join(cwd, "template.project.json"));
			await runInit();

			expect(result.isOk()).toBe(true);
			expect(interactive).toEqual(await readJson("default.rogen.json"));
			expect(interactiveTemplate).toEqual(
				await readJson("template.project.json")
			);
		});

		it("should write the answers", async () => {
			await write("default.rogen.json", "{}");
			const prompts = new MockPromptService([
				"separate",
				"game",
				"luau",
				true,
				"src, lib",
				"out",
				[],
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
			]);

			await runInit([], prompts);

			const source = await readJson("game.rogen.json");
			expect(source.rootDirs).toEqual(["src", "lib"]);
			expect((await readJson("game-sync.rogen.json")).syncDir).toBe(
				"out"
			);
		});

		it("should write the ticked routes and leave unmatched files out", async () => {
			const prompts = new MockPromptService([
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				["server", "starterGui"],
				"leave",
			]);

			await runInit([], prompts);

			expect((await readJson("default.rogen.json")).routes).toEqual({
				Server: "ServerScriptService",
				StarterGui: "StarterGui",
			});
		});

		it("should take the root dir placeholder from the code it finds", async () => {
			await write("game/Main.server.luau");
			const prompts = new MockPromptService(
				Array(9).fill(ACCEPT_DEFAULT)
			);

			await runInit([], prompts);

			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"game",
			]);
		});

		it("should mount a folder that is not installed as optional", async () => {
			const prompts = new MockPromptService([
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				["Packages"],
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
			]);

			await runInit([], prompts);

			expect(
				(await readJson("template.project.json")).tree.ReplicatedStorage
			).toEqual({ Packages: { $path: { optional: "Packages" } } });
		});

		it("should not ask for a name when default.rogen.json does not exist", async () => {
			const prompts = new MockPromptService(
				Array(9).fill(ACCEPT_DEFAULT)
			);

			await runInit([], prompts);

			expect(prompts.asked).not.toContain("Config name");
			expect(await exists("default.rogen.json")).toBe(true);
		});

		it("should ask for a name when default.rogen.json exists", async () => {
			await write("default.rogen.json", "{}");
			const prompts = new MockPromptService([
				"separate",
				"test",
				...Array(9).fill(ACCEPT_DEFAULT),
			]);

			await runInit([], prompts);

			expect(prompts.asked[1]).toBe("Config name");
			expect(await exists("test.rogen.json")).toBe(true);
			expect(await read("default.rogen.json")).toBe("{}");
		});

		it("should fail before any question when the given name is taken", async () => {
			await write("lobby.rogen.json", "{}");
			const prompts = new MockPromptService([]);

			const result = await runInit(["lobby"], prompts);

			expect(diagnosticsOf(result)).toMatchObject([
				{ code: "init.configExists" },
			]);
			expect(prompts.asked).toEqual([]);
		});

		it("should fail after the Darklua question when a file it would write exists", async () => {
			await write("sync.rogen.json", "{}");
			const prompts = new MockPromptService([
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				true,
			]);

			const result = await runInit([], prompts);

			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(cwd, "sync.rogen.json"),
				},
			]);
			expect(prompts.asked).toHaveLength(3);
			expect(await exists("default.rogen.json")).toBe(false);
		});

		it("should not ask for a name that was given", async () => {
			const prompts = new MockPromptService(
				Array(9).fill(ACCEPT_DEFAULT)
			);

			await runInit(["lobby"], prompts);

			expect(prompts.asked).not.toContain("Config name");
			expect(await exists("lobby.rogen.json")).toBe(true);
		});

		it("should write nothing when cancelled", async () => {
			const result = await runInit([], new MockPromptService([CANCEL]));

			expect((result as ResultError<Error>).error).toBeInstanceOf(
				CancelledError
			);
			expect(await exists("default.rogen.json")).toBe(false);
		});

		it("should not ask when there is no terminal", async () => {
			const prompts = new MockPromptService([], false);

			const result = await runInit([], prompts);

			expect(result.isOk()).toBe(true);
			expect(prompts.asked).toEqual([]);
		});
	});

	describe("places", () => {
		const setUpLuau = async () => {
			await write(
				"default.rogen.json",
				JSON.stringify({ rootDirs: ["src"] })
			);
			await write("src/A.luau");
		};
		const offerAnd = (...answers: ScriptedAnswer[]) =>
			new MockPromptService(["place", ...answers]);

		it("should ask what to add when default.rogen.json exists", async () => {
			await setUpLuau();
			const prompts = new MockPromptService([CANCEL]);

			await runInit([], prompts);

			expect(prompts.asked).toEqual([
				"default.rogen.json exists. What do you want to add?",
			]);
		});

		it("should not offer a place when default.rogen.json does not exist", async () => {
			const prompts = new MockPromptService(
				Array(9).fill(ACCEPT_DEFAULT)
			);

			await runInit([], prompts);

			expect(prompts.asked).not.toContain(
				"default.rogen.json exists. What do you want to add?"
			);
		});

		it("should ask for a place name when it can't ask what to add", async () => {
			await setUpLuau();
			const prompts = new MockPromptService([], false);

			const result = await runInit([], prompts);

			expect(prompts.asked).toEqual([]);
			expect(diagnosticsOf(result)).toMatchObject([
				{ code: "init.configExists" },
			]);
		});

		it("should write one config extending default, and only that", async () => {
			await setUpLuau();
			const before = await memFs.readDirectory(cwd);

			const result = await runInit([], offerAnd("lobby", ACCEPT_DEFAULT));

			expect(result.isOk()).toBe(true);
			expect(await readJson("lobby.rogen.json")).toEqual({
				$schema: SCHEMA_URL,
				extends: "./default.rogen.json",
				rootDirs: ["src", "places/lobby"],
			});
			const after = await memFs.readDirectory(cwd);
			expect(after.length).toBe(before.length + 1);
		});

		it("should ask the place name and folder, and nothing else", async () => {
			await setUpLuau();
			const prompts = offerAnd("lobby", "world/lobby");

			await runInit([], prompts);

			expect(prompts.asked).toEqual([
				"default.rogen.json exists. What do you want to add?",
				"Place name",
				"Place folder",
			]);
			expect(prompts.prompts[2]).toMatchObject({
				placeholder: "places/lobby",
			});
			expect((await readJson("lobby.rogen.json")).rootDirs).toEqual([
				"src",
				"world/lobby",
			]);
		});

		it("should not ask for a place name that was given", async () => {
			await setUpLuau();
			const prompts = offerAnd(ACCEPT_DEFAULT);

			await runInit(["lobby"], prompts);

			expect(prompts.asked).not.toContain("Place name");
			expect(await exists("lobby.rogen.json")).toBe(true);
		});

		it("should fail before the place folder when a given name would overwrite a Darklua synced config", async () => {
			await write(".darklua.json");
			await write("default.rogen.json", "{}");
			await write("lobby-sync.rogen.json", "{}");
			const prompts = offerAnd();

			const result = await runInit(["lobby"], prompts);

			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(cwd, "lobby-sync.rogen.json"),
				},
			]);
			expect(prompts.asked).toHaveLength(1);
		});

		it("should fail before the place folder when a given name would replace a project file", async () => {
			await setUpLuau();
			await write("lobby.project.json", "{}");
			const prompts = offerAnd();

			const result = await runInit(["lobby"], prompts);

			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.fileExists",
					resource: path.join(cwd, "lobby.project.json"),
				},
			]);
			expect(prompts.asked).toHaveLength(1);
		});

		it("should allow a place name whose -sync file exists when no synced config is written", async () => {
			await setUpLuau();
			await write("lobby-sync.rogen.json", "{}");

			const result = await runInit([], offerAnd("lobby", ACCEPT_DEFAULT));

			expect(result.isOk()).toBe(true);
		});

		it("should reject a place name that is taken", async () => {
			await setUpLuau();
			await write("lobby.rogen.json", "{}");

			await expect(
				runInit([], offerAnd("lobby", ACCEPT_DEFAULT))
			).rejects.toThrow("lobby.rogen.json already exists.");
		});

		it("should leave the shared config and everything else untouched", async () => {
			await setUpLuau();
			const defaultConfig = await read("default.rogen.json");

			await runInit([], offerAnd("lobby", ACCEPT_DEFAULT));

			expect(await read("default.rogen.json")).toBe(defaultConfig);
			expect(await exists("template.project.json")).toBe(false);
		});

		it("should write a source-rooted config and a synced config for a Darklua place", async () => {
			await write(".darklua.json");
			await write(
				"default.rogen.json",
				JSON.stringify({ rootDirs: ["src"] })
			);
			await write(
				"sync.rogen.json",
				JSON.stringify({
					extends: "./default.rogen.json",
					syncDir: "build",
				})
			);

			const logService = new MockLogService();

			await runInit([], offerAnd("lobby", ACCEPT_DEFAULT), logService);

			expect(await readJson("lobby.rogen.json")).toMatchObject({
				extends: "./default.rogen.json",
				rootDirs: ["src", "places/lobby"],
			});
			expect(await readJson("lobby-sync.rogen.json")).toMatchObject({
				extends: "./lobby.rogen.json",
				syncDir: "build/lobby",
			});
			expect(logService.lines).toEqual(
				expect.arrayContaining([
					"info: Have Darklua process your code into the sync dir:",
				])
			);
		});

		it("should write a config and a tsconfig for a roblox-ts place", async () => {
			await write("tsconfig.json", "{}");
			await write(
				"default.rogen.json",
				JSON.stringify({ rootDirs: ["src"], syncDir: "out" })
			);

			await runInit([], offerAnd("lobby", ACCEPT_DEFAULT));

			expect(await readJson("lobby.rogen.json")).toMatchObject({
				extends: "./default.rogen.json",
				rootDirs: ["src", "places/lobby"],
				syncDir: "out/lobby",
			});
			expect(await readJson("tsconfig.lobby.json")).toEqual({
				extends: "./tsconfig.json",
				compilerOptions: {
					rootDir: null,
					rootDirs: ["src", "places/lobby"],
					outDir: "out/lobby",
				},
				include: ["src", "places/lobby"],
			});
			expect(await read("tsconfig.json")).toBe("{}");
		});

		it("should print what to do next, including the missing include", async () => {
			await write("tsconfig.json", "{}");
			await write(
				"default.rogen.json",
				JSON.stringify({ rootDirs: ["src"], syncDir: "out" })
			);
			const logService = new MockLogService();

			await runInit([], offerAnd("lobby", ACCEPT_DEFAULT), logService);

			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: ",
				"success: Created lobby.rogen.json.",
				"success: Created tsconfig.lobby.json.",
				"step: Next steps",
				'info: Add "include": ["src"] to tsconfig.json, so its own build leaves out the place folders.',
				"info: Run each in its own terminal:",
				"info:   rbxtsc -w -p tsconfig.lobby.json --rojo lobby.project.json",
				"info:   rogen watch lobby",
				"info:   rojo serve lobby.project.json",
				'info: Add tags under "tags" in lobby.rogen.json to swap in variants like Analytics.mock.ts.',
				"outro: Wrote 2 files.",
			]);
		});

		it("should fail with diagnostics when default.rogen.json is broken", async () => {
			await write("default.rogen.json", "{ nope");

			const result = await runInit([], offerAnd("lobby", ACCEPT_DEFAULT));

			expect(result.isErr()).toBe(true);
			expect(await exists("lobby.rogen.json")).toBe(false);
		});

		it("should fall through to the full flow when declined", async () => {
			await setUpLuau();
			const prompts = new MockPromptService([
				"separate",
				"test",
				...Array(9).fill(ACCEPT_DEFAULT),
			]);

			await runInit([], prompts);

			expect(prompts.asked.slice(1, 3)).toEqual([
				"Config name",
				"Language",
			]);
			expect((await readJson("test.rogen.json")).routes).toEqual(
				LUAU_ROUTES
			);
			expect((await readJson("test.rogen.json")).extends).toBeUndefined();
		});

		it("should reject a taken name at the prompt when declined", async () => {
			await setUpLuau();
			await write("test.rogen.json", "{}");

			await expect(
				runInit([], new MockPromptService(["separate", "test"]))
			).rejects.toThrow("test.rogen.json already exists.");
		});

		it("should use the given name for the full flow when declined", async () => {
			await setUpLuau();
			const prompts = new MockPromptService([
				"separate",
				...Array(9).fill(ACCEPT_DEFAULT),
			]);

			await runInit(["test"], prompts);

			expect(prompts.asked).not.toContain("Config name");
			expect(await exists("test.rogen.json")).toBe(true);
		});

		it("should write nothing when cancelled at the place folder", async () => {
			await setUpLuau();

			const result = await runInit([], offerAnd("lobby", CANCEL));

			expect(result.isErr()).toBe(true);
			expect(await exists("lobby.rogen.json")).toBe(false);
		});
	});

	describe("several places", () => {
		it("should write default and one config per detected place without a terminal", async () => {
			await write("src/A.luau");
			await write("places/lobby/B.luau");
			await write("places/match/C.luau");

			const result = await runInit();

			expect(result.isOk()).toBe(true);
			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"src",
			]);
			expect(await readJson("lobby.rogen.json")).toEqual({
				$schema: SCHEMA_URL,
				extends: "./default.rogen.json",
				rootDirs: ["src", "places/lobby"],
			});
			expect((await readJson("match.rogen.json")).rootDirs).toEqual([
				"src",
				"places/match",
			]);
		});

		it("should write one config when a name is given", async () => {
			await write("places/lobby/B.luau");

			await runInit(["game"]);

			expect(await exists("game.rogen.json")).toBe(true);
			expect(await exists("lobby.rogen.json")).toBe(false);
		});

		it("should write a tsconfig per roblox-ts place and say how to switch", async () => {
			await write("tsconfig.json", '{ "include": ["src"] }');
			await write("places/lobby/B.ts");
			await write("places/match/C.ts");
			const logService = new MockLogService();

			await runInit([], new MockPromptService([], false), logService);

			expect(await exists("tsconfig.lobby.json")).toBe(true);
			expect(await exists("tsconfig.match.json")).toBe(true);
			expect(logService.lines).toEqual(
				expect.arrayContaining([
					"info:   rbxtsc -w -p tsconfig.lobby.json --rojo lobby.project.json",
					"info: Swap lobby for match to work on another place.",
				])
			);
		});
	});

	describe("variants", () => {
		beforeEach(async () => {
			await write(
				"default.rogen.json",
				JSON.stringify({ rootDirs: ["src"] })
			);
		});

		it("should write a config that extends default", async () => {
			const result = await runInit(
				[],
				new MockPromptService(["variant", "prod"])
			);

			expect(result.isOk()).toBe(true);
			expect(await readJson("prod.rogen.json")).toEqual({
				$schema: SCHEMA_URL,
				extends: "./default.rogen.json",
			});
		});

		it("should not ask for a variant name that was given", async () => {
			const prompts = new MockPromptService(["variant"]);

			const result = await runInit(["prod"], prompts);

			expect(result.isOk()).toBe(true);
			expect(prompts.asked).toEqual([
				"default.rogen.json exists. What do you want to add?",
			]);
			expect(await exists("prod.rogen.json")).toBe(true);
		});

		it("should say how to run the variant and where its tags go", async () => {
			const logService = new MockLogService();

			await runInit(
				[],
				new MockPromptService(["variant", "prod"]),
				logService
			);

			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: ",
				"success: Created prod.rogen.json.",
				"step: Next steps",
				"info: Run each in its own terminal:",
				"info:   rogen watch prod",
				"info:   rojo serve prod.project.json",
				'info: Turn tags on or off under "tags", or add "exclude", in prod.rogen.json.',
				"outro: Wrote 1 file.",
			]);
		});

		it("should fail before asking more when a given variant name would replace a project file", async () => {
			await write("prod.project.json", "{}");
			const prompts = new MockPromptService(["variant"]);

			const result = await runInit(["prod"], prompts);

			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.fileExists",
					resource: path.join(cwd, "prod.project.json"),
				},
			]);
			expect(prompts.asked).toHaveLength(1);
		});
	});

	describe("existing files", () => {
		it("should fail when default.rogen.json exists, and leave it alone", async () => {
			await write("default.rogen.json", "{}");

			const result = await runInit();

			expect(result.isErr()).toBe(true);
			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(cwd, "default.rogen.json"),
				},
			]);
			expect(await read("default.rogen.json")).toBe("{}");
		});

		it("should fail when the named config exists", async () => {
			await write("lobby.rogen.json", "{}");

			const result = await runInit(["lobby"]);

			expect(result.isErr()).toBe(true);
			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(cwd, "lobby.rogen.json"),
				},
			]);
		});

		it("should allow a named init beside an existing default config", async () => {
			await write("default.rogen.json", "{}");

			const result = await runInit(["lobby"]);

			expect(result.isOk()).toBe(true);
			expect(await read("default.rogen.json")).toBe("{}");
			expect(await exists("lobby.rogen.json")).toBe(true);
		});

		it("should write nothing when one darklua file already exists", async () => {
			await write(".darklua.json");
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));
			await write("sync.rogen.json", "{}");

			const result = await runInit();

			expect(result.isErr()).toBe(true);
			expect(await exists("default.rogen.json")).toBe(false);
			expect(await exists("template.project.json")).toBe(false);
		});

		it("should keep a hand-written default.project.json as the template", async () => {
			await write("default.project.json", '{"name":"hand-written"}');
			const logService = new MockLogService();

			const result = await runInit(
				[],
				new MockPromptService([], false),
				logService
			);

			expect(result.isOk()).toBe(true);
			expect(await read("default.project.json")).toBe(
				'{"name":"hand-written"}'
			);
			expect(await read("template.project.json")).toBe(
				'{"name":"hand-written"}'
			);
			expect((await readJson("default.rogen.json")).template).toBe(
				"template.project.json"
			);
			expect(logService.lines).toContain(
				"info: Copying default.project.json to template.project.json, since Rogen replaces default.project.json on every build."
			);
		});

		it("should leave a project file that another config writes alone", async () => {
			await write("lobby.rogen.json", "{}");
			await write("lobby.project.json", "{}");

			await runInit();

			expect(await exists("template.project.json")).toBe(false);
		});
	});

	it("should return a structured error if writing a file fails", async () => {
		jest.spyOn(memFs, "writeFile").mockRejectedValue(
			new Error("Permission denied")
		);

		const result = await runInit();

		expect(result.isErr()).toBe(true);
		expect(errorMessage(result)).toContain(
			"Failed to write default.rogen.json"
		);
		expect(errorMessage(result)).toContain("Permission denied");
	});

	describe("flags", () => {
		const registry = Registry.as<CommandRegistry>(Extensions.Commands);
		const parse = (...argv: string[]) =>
			parseArgs(
				argv,
				(command) => registry.getOptions(command),
				(command) => registry.getCommand(command) !== undefined
			);

		it("should not accept the override flags", () => {
			expect(parse("init", "-t", "mock").isErr()).toBe(true);
		});
	});
});
