import { jest } from "@jest/globals";
import path from "path";
import "../init-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { DisposableStore } from "../../../base/disposable.js";
import { CancelledError } from "../../../base/errors.js";
import { ResultError } from "../../../base/result.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { SCHEMA_URL } from "../../../domain/config/config.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { configSchema } from "../../../domain/config/config-schema.js";
import { ConfigFileReader } from "../../../platform/config/config-file.js";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { PromptService } from "../../../platform/prompt/prompt-service.js";
import {
	CANCEL,
	MockPromptService,
	ScriptedAnswers,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { CommandLine, parseArgs } from "../../../platform/environment/args.js";
import {
	CommandRegistry,
	Extensions,
} from "../../../platform/commands/commands.js";
import { Registry } from "../../../platform/registry/registry.js";

const WHAT_TO_ADD = "default.rogen.json exists. What do you want to add?";
const LUAU_ROUTES = {
	Server: "ServerScriptService",
	Client: "StarterPlayer/StarterPlayerScripts",
	Shared: "ReplicatedStorage/Shared",
	"*": "ReplicatedStorage/Shared",
};

describe("init command", () => {
	const cwd = path.resolve("/mock/my-game");
	let memFs: MemoryFileSystemService;
	let store: DisposableStore;

	const runInit = async (
		names: string[] = [],
		prompt: PromptService = new MockPromptService([], false),
		log: MockLogService = new MockLogService(),
		options: CommandLine["options"] = {}
	) => {
		const harness = commandHarness({
			cwd,
			fs: memFs,
			log,
			prompt,
			environment: new NativeEnvironmentService(options, cwd),
		});
		return harness.run("init", { positionals: names, options });
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

		it("should print only the files written, the builds and the next steps as one document", async () => {
			await write("tsconfig.json", "{}");
			await runInit();

			const { result, logService } = await runJson(["lobby"]);

			expect(result.isOk()).toBe(true);
			expect(logService.entries.map(({ kind }) => kind)).toEqual([
				"print",
			]);
			expect(JSON.parse(logService.entries[0].text)).toEqual({
				appended: [],
				files: [
					path.join(cwd, "lobby.rogen.json"),
					path.join(cwd, "places/lobby/template.project.json"),
					path.join(cwd, "tsconfig.lobby.json"),
				],
				directories: [path.join(cwd, "places/lobby/src")],
				built: [
					{
						config: "lobby",
						file: path.join(cwd, "lobby.rogen.json"),
						outFile: path.join(cwd, "lobby.project.json"),
						outcome: "wrote",
						diagnostics: [],
					},
				],
				notes: [],
				nextSteps: {
					setup: [
						'Add "include": ["src"] to tsconfig.json, so its own build leaves out the place folders.',
					],
					run: [
						"rbxtsc -w -p tsconfig.lobby.json --rojo lobby.project.json",
						"rogen serve",
					],
					darklua: [],
					edits: [
						'Declare variants under "variants" in lobby.rogen.json to swap in files like Analytics.mock.ts, and turn them on in a mode or with --variant.',
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
				appended: [],
				files: [
					path.join(cwd, "lobby.rogen.json"),
					path.join(cwd, "places/lobby/template.project.json"),
				],
				directories: [],
				error: "Failed to write tsconfig.lobby.json: disk full",
			});
		});

		it("should be accepted on the command line", () => {
			const registry = Registry.as<CommandRegistry>(Extensions.Commands);
			const parsed = parseArgs(
				["init", "--json"],
				(command) => registry.getOptions(command),
				[...registry.getCommands().keys()]
			);

			expect(parsed.unwrap().line.options.json).toBe(true);
		});
	});

	describe("agent instructions", () => {
		it("should say it added Rogen's rules to an agent file that exists", async () => {
			await write("AGENTS.md", "# Rules\n");
			const logService = new MockLogService();

			await runInit([], new MockPromptService([], false), logService);

			expect(logService.lines).toContain(
				"success: Added Rogen's rules to AGENTS.md."
			);
			expect(await memFs.readFile(path.join(cwd, "AGENTS.md"))).toMatch(
				/^# Rules\n\n<!-- rogen -->\n/
			);
		});

		it("should list an appended agent file under appended in JSON", async () => {
			await write("CLAUDE.md", "Use tabs.\n");
			const logService = new MockLogService();

			await runInit([], new MockPromptService([], false), logService, {
				json: true,
			});

			expect(JSON.parse(logService.entries[0].text).appended).toEqual([
				path.join(cwd, "CLAUDE.md"),
			]);
		});
	});

	describe("output", () => {
		it("should open with a header, list each file written and close with a result", async () => {
			const logService = new MockLogService();

			await runInit([], new MockPromptService([], false), logService);

			expect(logService.lines).toEqual([
				"intro: rogen init",
				"success: Created default.rogen.json.",
				"success: Created AGENTS.md.",
				"success: Created src/.",
				"success: default.project.json · wrote",
				"step: Next steps",
				"info: Run:",
				"info:   rogen serve",
				'info: Add your own routes under "routes" in default.rogen.json.',
				'info: Declare variants under "variants" in default.rogen.json to swap in files like Analytics.mock.luau, and turn them on in a mode or with --variant.',
				"outro: Wrote 2 files.",
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

	describe("first build", () => {
		it("should write the project file of the config it wrote", async () => {
			await write("src/Inventory/Server/Save.luau");

			await runInit();

			expect(
				(await readJson("default.project.json")).tree
					.ServerScriptService.Inventory
			).toBeDefined();
		});

		it("should build nothing when it wrote no config", async () => {
			await write("default.rogen.json", "{}");
			const logService = new MockLogService();

			const result = await runInit(
				[],
				new MockPromptService(["agent"]),
				logService
			);

			expect(result.isOk()).toBe(true);
			expect(await exists("default.project.json")).toBe(false);
			expect(logService.lines).not.toContainEqual(
				expect.stringContaining("project.json")
			);
		});

		it("should build the place it added, not the configs beside it", async () => {
			await runInit();
			await memFs.delete(path.join(cwd, "default.project.json"));

			await runInit(["lobby"]);

			expect(await exists("lobby.project.json")).toBe(true);
			expect(await exists("default.project.json")).toBe(false);
		});

		it("should leave out the warning that the compiler has not run yet", async () => {
			await write("tsconfig.json", "{}");
			const logService = new MockLogService();

			await runInit([], new MockPromptService([], false), logService);

			expect(
				logService.lines.filter((line) => line.includes("output."))
			).toEqual([]);
		});

		it("should say what is wrong with the routes it wrote", async () => {
			await write("src/Save@sever.luau");
			const logService = new MockLogService();

			await runInit([], new MockPromptService([], false), logService);

			expect(logService.lines).toContainEqual(
				expect.stringContaining("(route.strayAt)")
			);
		});

		it("should keep the files and fail when the project file cannot be written", async () => {
			const writeFile = memFs.writeFile.bind(memFs);
			jest.spyOn(memFs, "writeFile").mockImplementation(
				async (file, content) => {
					if (file.includes("default.project.json"))
						throw new Error("disk full");
					return writeFile(file, content);
				}
			);
			const logService = new MockLogService();

			const result = await runInit(
				[],
				new MockPromptService([], false),
				logService
			);

			expect(result.isErr()).toBe(true);
			expect(await exists("default.rogen.json")).toBe(true);
			expect(logService.lines).not.toContain("step: Next steps");
		});

		it("should list the build of each config in the JSON document", async () => {
			const logService = new MockLogService();

			await runInit([], new MockPromptService([], false), logService, {
				json: true,
			});

			expect(JSON.parse(logService.entries[0].text).built).toEqual([
				{
					config: "default",
					file: path.join(cwd, "default.rogen.json"),
					outFile: path.join(cwd, "default.project.json"),
					outcome: "wrote",
					diagnostics: [],
				},
			]);
		});
	});

	describe("agent hook", () => {
		const accepting = () => new MockPromptService({});

		it("should say it created the script and the agent's file", async () => {
			await write(".claude/keep");
			const logService = new MockLogService();

			await runInit([], accepting(), logService);

			expect(logService.lines).toEqual(
				expect.arrayContaining([
					"success: Created .agents/hooks/rogen-check.sh.",
					"success: Created .claude/settings.json.",
				])
			);
			expect(await exists(".agents/hooks/rogen-check.sh")).toBe(true);
		});

		it("should say it added the hook to a file that exists, and list it as appended", async () => {
			await write(".codex/hooks.json", "{}\n");
			const logService = new MockLogService();

			await runInit([], accepting(), logService);

			expect(logService.lines).toContain(
				"success: Added the Rogen hook to .codex/hooks.json."
			);
			expect(
				(await readJson(".codex/hooks.json")).hooks.Stop
			).toHaveLength(1);
		});

		it("should not write it in a run that can't ask", async () => {
			await write(".claude/keep");

			await runInit();

			expect(await exists(".agents/hooks/rogen-check.sh")).toBe(false);
		});
	});

	describe("package mounts", () => {
		it("should let a later place merge its own template over default's", async () => {
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();
			const template = await read("template.project.json");
			await runInit(["lobby"]);

			expect(await read("template.project.json")).toBe(template);
			const entry = await new CoreConfigService(
				memFs,
				new NativeEnvironmentService({}, cwd)
			).read(path.join(cwd, "lobby.rogen.json"));
			expect(entry.status).toBe("valid");
			if (entry.status !== "valid") return;
			expect(entry.config.template?.project.getFile()).toMatchObject({
				name: "Lobby",
				servePort: 34873,
				tree: {
					ReplicatedStorage: {
						Packages: { $path: "../../Packages" },
					},
				},
			});
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
			const prompts = new MockPromptService({});

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
			const prompts = new MockPromptService({
				[WHAT_TO_ADD]: "separate",
				"Config name": "game",
				Language: "luau",
				"Does Darklua process your code before Rojo syncs it?": true,
				"Root dirs": "src, lib",
				"Sync dir": "out",
				Routes: [],
			});

			await runInit([], prompts);

			const source = await readJson("game.rogen.json");
			expect(source.rootDirs).toEqual(["src", "lib"]);
			expect((await readJson("game-sync.rogen.json")).syncDir).toBe(
				"out"
			);
		});

		it("should write the ticked routes and leave unmatched files out", async () => {
			const prompts = new MockPromptService({
				Routes: ["server", "starterGui"],
				"Files that match no route": "leave",
			});

			await runInit([], prompts);

			expect((await readJson("default.rogen.json")).routes).toEqual({
				Server: "ServerScriptService",
				StarterGui: "StarterGui",
			});
		});

		it("should take the root dir placeholder from the code it finds", async () => {
			await write("game/Main.server.luau");
			const prompts = new MockPromptService({});

			await runInit([], prompts);

			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"game",
			]);
		});

		it("should mount a folder that is not installed as optional", async () => {
			await write("wally.toml");
			const prompts = new MockPromptService({ Packages: ["Packages"] });

			await runInit([], prompts);

			expect(
				(await readJson("template.project.json")).tree.ReplicatedStorage
			).toEqual({ Packages: { $path: { optional: "Packages" } } });
		});

		it("should ask seven questions on a bare Luau folder, none of them about packages", async () => {
			const prompts = new MockPromptService({});

			await runInit([], prompts);

			expect(prompts.asked).toEqual([
				"What are you setting up?",
				"Language",
				"Does Darklua process your code before Rojo syncs it?",
				"Root dirs",
				"Routes",
				"Files that match no route",
				expect.stringContaining("Rogen's rules for coding agents"),
			]);
			expect(await exists("template.project.json")).toBe(false);
		});

		it("should still ask about packages when a manifest is there", async () => {
			await write("wally.toml");
			const prompts = new MockPromptService({});

			await runInit([], prompts);

			expect(prompts.asked).toContain("Packages");
		});

		it("should not ask for a name when default.rogen.json does not exist", async () => {
			const prompts = new MockPromptService({});

			await runInit([], prompts);

			expect(prompts.asked).not.toContain("Config name");
			expect(await exists("default.rogen.json")).toBe(true);
		});

		it("should ask for a name when default.rogen.json exists", async () => {
			await write("default.rogen.json", "{}");
			const prompts = new MockPromptService({
				[WHAT_TO_ADD]: "separate",
				"Config name": "test",
			});

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
			const prompts = new MockPromptService({
				"Does Darklua process your code before Rojo syncs it?": true,
			});

			const result = await runInit([], prompts);

			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(cwd, "sync.rogen.json"),
				},
			]);
			expect(prompts.asked).toHaveLength(4);
			expect(await exists("default.rogen.json")).toBe(false);
		});

		it("should not ask for a name that was given", async () => {
			const prompts = new MockPromptService({});

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
				JSON.stringify({ rootDirs: ["src"], routes: LUAU_ROUTES })
			);
			await write("src/A.luau");
		};
		const offerAnd = (answers: ScriptedAnswers = {}) =>
			new MockPromptService({ [WHAT_TO_ADD]: "place", ...answers });

		it("should not offer a place when default.rogen.json does not exist", async () => {
			const prompts = new MockPromptService({});

			await runInit([], prompts);

			expect(prompts.asked).not.toContain(WHAT_TO_ADD);
		});

		it("should write one config extending default, with the place's code in src and its template beside it", async () => {
			await setUpLuau();
			const before = await memFs.readDirectory(cwd);

			const result = await runInit(
				[],
				offerAnd({ "Place name": "lobby" })
			);

			expect(result.isOk()).toBe(true);
			expect(await readJson("lobby.rogen.json")).toEqual({
				$schema: SCHEMA_URL,
				extends: "./default.rogen.json",
				rootDirs: ["places/lobby/src"],
				template: "places/lobby/template.project.json",
			});
			expect(
				await readJson("places/lobby/template.project.json")
			).toEqual({
				name: "Lobby",
				servePort: 34873,
				tree: { $className: "DataModel" },
			});
			const after = await memFs.readDirectory(cwd);
			expect(after.length).toBe(before.length + 3);
		});

		it("should create the place's src so the next build finds it", async () => {
			await setUpLuau();

			await runInit([], offerAnd({ "Place name": "lobby" }));

			expect(await exists("places/lobby/src")).toBe(true);
		});

		it("should give a place the first port above 34872 no other config's template uses", async () => {
			await setUpLuau();
			await write(
				"arena.rogen.json",
				JSON.stringify({
					extends: "./default.rogen.json",
					template: "arena.template.json",
				})
			);
			await write(
				"arena.template.json",
				JSON.stringify({
					name: "Arena",
					servePort: 34873,
					tree: { $className: "DataModel" },
				})
			);
			await write(
				"shop.rogen.json",
				JSON.stringify({
					extends: "./default.rogen.json",
					template: "shop.template.json",
				})
			);
			await write(
				"shop.template.json",
				JSON.stringify({
					name: "Shop",
					servePort: 34875,
					tree: { $className: "DataModel" },
				})
			);

			await runInit(["lobby"]);

			expect(
				(await readJson("places/lobby/template.project.json")).servePort
			).toBe(34874);
		});

		it("should put the place folder beside the shared folder default's root dir is in", async () => {
			await write(
				"default.rogen.json",
				JSON.stringify({
					rootDirs: ["projects/shared/src"],
					routes: LUAU_ROUTES,
				})
			);

			await runInit(["lobby"]);

			expect(await readJson("lobby.rogen.json")).toMatchObject({
				rootDirs: ["projects/lobby/src"],
				template: "projects/lobby/template.project.json",
			});
		});

		it("should keep a place folder that already holds code as the root dir, with the template beside it", async () => {
			await setUpLuau();
			await write("places/lobby/Main.luau", "");
			const logService = new MockLogService();

			await runInit([], offerAnd({ "Place name": "lobby" }), logService);

			expect(await readJson("lobby.rogen.json")).toMatchObject({
				rootDirs: ["places/lobby"],
				template: "places/lobby.template.project.json",
			});
			expect(
				await readJson("places/lobby.template.project.json")
			).toEqual({
				name: "Lobby",
				servePort: 34873,
				tree: { $className: "DataModel" },
			});
			expect(await exists("places/lobby/src")).toBe(false);
			expect(logService.lines).not.toContain(
				"success: Created places/lobby/."
			);
		});

		it("should root a place folder that already has src in src", async () => {
			await setUpLuau();
			await write("places/lobby/src/Main.luau", "");

			await runInit(["lobby"]);

			expect(await readJson("lobby.rogen.json")).toMatchObject({
				rootDirs: ["places/lobby/src"],
				template: "places/lobby/template.project.json",
			});
		});

		it("should use a place template that is already there, as it is", async () => {
			await setUpLuau();
			await write(
				"places/lobby/template.project.json",
				'{ "name": "Mine" }'
			);
			const logService = new MockLogService();

			await runInit(["lobby"], undefined, logService);

			expect(await read("places/lobby/template.project.json")).toBe(
				'{ "name": "Mine" }'
			);
			expect((await readJson("lobby.rogen.json")).template).toBe(
				"places/lobby/template.project.json"
			);
			expect(logService.lines).toContain(
				"info: Using places/lobby/template.project.json."
			);
		});

		it("should name the place to serve when other configs here share a port", async () => {
			await setUpLuau();
			await write(
				"arena.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);
			await write(
				"shop.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);
			const logService = new MockLogService();

			await runInit(["lobby"], undefined, logService);

			expect(logService.lines).toContain("info:   rogen serve lobby");
		});

		it("should serve every place, now that each has its own port", async () => {
			await setUpLuau();
			const logService = new MockLogService();

			await runInit(["lobby"], undefined, logService);

			expect(logService.lines).toContain("info:   rogen serve");
		});

		it("should build a place that serves on its own port and under its own name", async () => {
			await setUpLuau();

			await runInit(["lobby"]);

			const entry = await new CoreConfigService(
				memFs,
				new NativeEnvironmentService({}, cwd)
			).read(path.join(cwd, "lobby.rogen.json"));
			expect(entry.status).toBe("valid");
			if (entry.status !== "valid") return;
			expect(entry.config.name).toBe("Lobby");
			expect(entry.config.template?.project.servePort).toBe(34873);
		});

		it("should ask the place name and folder, and nothing else", async () => {
			await setUpLuau();
			const prompts = offerAnd({
				"Place name": "lobby",
				"Place folder": "world/lobby",
			});

			await runInit([], prompts);

			expect(prompts.asked).toEqual([
				WHAT_TO_ADD,
				"Place name",
				"Place folder",
			]);
			expect(prompts.prompts[2]).toMatchObject({
				placeholder: "places/lobby",
			});
			expect((await readJson("lobby.rogen.json")).rootDirs).toEqual([
				"world/lobby/src",
			]);
		});

		it("should not ask for a place name that was given", async () => {
			await setUpLuau();
			const prompts = offerAnd();

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

			const result = await runInit(
				[],
				offerAnd({ "Place name": "lobby" })
			);

			expect(result.isOk()).toBe(true);
		});

		it("should reject a place name that is taken", async () => {
			await setUpLuau();
			await write("lobby.rogen.json", "{}");

			await expect(
				runInit([], offerAnd({ "Place name": "lobby" }))
			).rejects.toThrow("lobby.rogen.json already exists.");
		});

		it("should leave the shared config and everything else untouched", async () => {
			await setUpLuau();
			const defaultConfig = await read("default.rogen.json");

			await runInit([], offerAnd({ "Place name": "lobby" }));

			expect(await read("default.rogen.json")).toBe(defaultConfig);
			expect(await exists("template.project.json")).toBe(false);
		});

		it("should print what to do next, including the missing include", async () => {
			await write("tsconfig.json", "{}");
			await write("src/A.ts");
			await write(
				"default.rogen.json",
				JSON.stringify({
					rootDirs: ["src"],
					routes: LUAU_ROUTES,
					syncDir: "out",
				})
			);
			const logService = new MockLogService();

			await runInit([], offerAnd({ "Place name": "lobby" }), logService);

			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: ",
				"success: Created lobby.rogen.json.",
				"success: Created places/lobby/template.project.json.",
				"success: Created tsconfig.lobby.json.",
				"success: Created places/lobby/src/.",
				"success: lobby.project.json · wrote",
				"step: Next steps",
				'info: Add "include": ["src"] to tsconfig.json, so its own build leaves out the place folders.',
				"info: Run each in its own terminal:",
				"info:   rbxtsc -w -p tsconfig.lobby.json --rojo lobby.project.json",
				"info:   rogen serve",
				'info: Declare variants under "variants" in lobby.rogen.json to swap in files like Analytics.mock.ts, and turn them on in a mode or with --variant.',
				"outro: Wrote 3 files.",
			]);
		});

		it("should fall through to the full flow when declined", async () => {
			await setUpLuau();
			const prompts = new MockPromptService({
				[WHAT_TO_ADD]: "separate",
				"Config name": "test",
			});

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
			const prompts = new MockPromptService({
				[WHAT_TO_ADD]: "separate",
			});

			await runInit(["test"], prompts);

			expect(prompts.asked).not.toContain("Config name");
			expect(await exists("test.rogen.json")).toBe(true);
		});

		it("should write nothing when cancelled at the place folder", async () => {
			await setUpLuau();

			const result = await runInit(
				[],
				offerAnd({ "Place name": "lobby", "Place folder": CANCEL })
			);

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
				rootDirs: ["places/lobby"],
				template: "places/lobby.template.project.json",
			});
			expect(await readJson("match.rogen.json")).toMatchObject({
				rootDirs: ["places/match"],
				template: "places/match.template.project.json",
			});
			expect(
				await readJson("places/match.template.project.json")
			).toEqual({
				name: "Match",
				servePort: 34874,
				tree: { $className: "DataModel" },
			});
		});

		it("should not take the shared folder for a place", async () => {
			await write("places/shared/src/Types.luau");
			await write("places/lobby/src/Queue.luau");

			await runInit();

			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"places/shared/src",
			]);
			expect(await exists("shared.rogen.json")).toBe(false);
			expect((await readJson("lobby.rogen.json")).rootDirs).toEqual([
				"places/lobby/src",
			]);
		});

		it("should put the shared code in places/shared by default, beside the places", async () => {
			const prompts = new MockPromptService({
				"What are you setting up?": "several",
				Places: "lobby, arena",
			});

			const result = await runInit([], prompts);

			expect(result.isOk()).toBe(true);
			expect(prompts.asked).toContain("Shared code");
			expect(prompts.asked).not.toContain("Root dirs");
			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"places/shared/src",
			]);
			expect(await readJson("arena.rogen.json")).toMatchObject({
				rootDirs: ["places/arena/src"],
				template: "places/arena/template.project.json",
			});
			expect(
				await readJson("places/arena/template.project.json")
			).toEqual({
				name: "Arena",
				servePort: 34874,
				tree: { $className: "DataModel" },
			});
			expect(await exists("places/shared/src")).toBe(true);
			expect(await exists("places/lobby/src")).toBe(true);
		});

		it("should start the shared template in places/shared, mounting packages from there", async () => {
			await write("wally.toml");
			await write("Packages/Foo.lua");
			const prompts = new MockPromptService({
				"What are you setting up?": "several",
				Places: "lobby",
			});

			await runInit([], prompts);

			expect((await readJson("default.rogen.json")).template).toBe(
				"places/shared/template.project.json"
			);
			expect(
				await readJson("places/shared/template.project.json")
			).toMatchObject({
				tree: {
					ReplicatedStorage: {
						Packages: { $path: "../../Packages" },
					},
				},
			});
		});

		it("should use a shared template that is already there, as it is", async () => {
			await write("wally.toml");
			await write("Packages/Foo.lua");
			await write(
				"places/shared/template.project.json",
				'{ "name": "Mine" }'
			);
			const prompts = new MockPromptService({
				"What are you setting up?": "several",
				Places: "lobby",
			});

			const result = await runInit([], prompts);

			expect(result.isOk()).toBe(true);
			expect(await read("places/shared/template.project.json")).toBe(
				'{ "name": "Mine" }'
			);
			expect((await readJson("default.rogen.json")).template).toBe(
				"places/shared/template.project.json"
			);
		});

		it("should take other shared folders when that is the answer", async () => {
			await write("lib/A.luau");
			await write("common/B.luau");
			const prompts = new MockPromptService({
				"What are you setting up?": "several",
				"Shared code": "other",
				"Root dirs": "lib, common",
				Places: "lobby",
			});

			await runInit([], prompts);

			expect(prompts.asked).toContain("Root dirs");
			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"lib",
				"common",
			]);
			expect((await readJson("lobby.rogen.json")).rootDirs).toEqual([
				"places/lobby/src",
			]);
		});

		it("should keep a detected place in its folder wherever the shared code is", async () => {
			await write("game/shared/A.luau");
			await write("places/lobby/src/B.luau");
			const prompts = new MockPromptService({
				"Shared code": "other",
				"Root dirs": "game/shared",
			});

			await runInit([], prompts);

			expect((await readJson("lobby.rogen.json")).rootDirs).toEqual([
				"places/lobby/src",
			]);
		});

		it("should have Darklua process every place, and serve their synced configs", async () => {
			await write(".darklua.json");
			await write("places/lobby/src/A.luau");
			await write("places/arena/src/B.luau");
			const logService = new MockLogService();

			await runInit([], undefined, logService);

			expect(logService.lines).toEqual(
				expect.arrayContaining([
					"info: Have Darklua process your code into the sync dir:",
					"info:   darklua process places/shared/src dist/lobby/shared/src",
					"info:   darklua process places/arena/src dist/arena/arena/src",
					"info:   rogen serve arena-sync lobby-sync",
				])
			);
			expect(
				logService.lines.filter((line) =>
					line.includes("rojo sourcemap")
				)
			).toHaveLength(1);
		});

		it("should keep the shared code at the root when that is the answer", async () => {
			const prompts = new MockPromptService({
				"What are you setting up?": "several",
				"Shared code": "src",
				Places: "lobby",
			});

			await runInit([], prompts);

			expect((await readJson("default.rogen.json")).rootDirs).toEqual([
				"src",
			]);
			expect(await readJson("lobby.rogen.json")).toMatchObject({
				rootDirs: ["places/lobby/src"],
				template: "places/lobby/template.project.json",
			});
		});

		it("should write one config when a name is given", async () => {
			await write("places/lobby/B.luau");

			await runInit(["game"]);

			expect(await exists("game.rogen.json")).toBe(true);
			expect(await exists("lobby.rogen.json")).toBe(false);
		});

		it("should write a tsconfig per roblox-ts place and compile each", async () => {
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
					"info:   rbxtsc -w -p tsconfig.match.json --rojo match.project.json",
					"info:   rogen serve",
				])
			);
		});
	});

	describe("extending configs", () => {
		beforeEach(async () => {
			await write(
				"default.rogen.json",
				JSON.stringify({ rootDirs: ["src"], routes: LUAU_ROUTES })
			);
			await write("src/A.luau");
		});

		it("should write a config that extends default", async () => {
			const result = await runInit(
				[],
				new MockPromptService(["extending", "prod"])
			);

			expect(result.isOk()).toBe(true);
			expect(await readJson("prod.rogen.json")).toEqual({
				$schema: SCHEMA_URL,
				extends: "./default.rogen.json",
			});
		});

		it("should not ask for a config name that was given", async () => {
			const prompts = new MockPromptService(["extending"]);

			const result = await runInit(["prod"], prompts);

			expect(result.isOk()).toBe(true);
			expect(prompts.asked).toEqual([WHAT_TO_ADD]);
			expect(await exists("prod.rogen.json")).toBe(true);
		});

		it("should say how to run the extending config and where its variants go", async () => {
			const logService = new MockLogService();

			await runInit(
				[],
				new MockPromptService(["extending", "prod"]),
				logService
			);

			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: ",
				"success: Created prod.rogen.json.",
				"success: prod.project.json · wrote",
				"step: Next steps",
				"info: Run:",
				"info:   rogen serve prod",
				'info: Add "exclude" or "modes", or pin a "mode", in prod.rogen.json.',
				"outro: Wrote 1 file.",
			]);
		});

		it("should fail before asking more when a given config name would replace a project file", async () => {
			await write("prod.project.json", "{}");
			const prompts = new MockPromptService(["extending"]);

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
			const config = JSON.stringify({ routes: LUAU_ROUTES });
			await write("default.rogen.json", config);

			const result = await runInit(["lobby"]);

			expect(result.isOk()).toBe(true);
			expect(await read("default.rogen.json")).toBe(config);
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
			expect((await readJson("default.project.json")).name).toBe(
				"hand-written"
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
			parseArgs(argv, (command) => registry.getOptions(command), [
				...registry.getCommands().keys(),
			]);

		it("should not accept the override flags", () => {
			expect(parse("init", "--variant", "mock").isErr()).toBe(true);
		});
	});
});
