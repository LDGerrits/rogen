import { jest } from "@jest/globals";
import path from "path";
import "../init-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
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
		await memFs.createDirectory(cwd);
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

		it("should not head next steps when adding the agent rules leaves none", async () => {
			await write("default.rogen.json", "{}");
			const log = new MockLogService();

			await runInit(
				[],
				new MockPromptService({ [WHAT_TO_ADD]: "agent" }),
				log
			);

			expect(await exists("AGENTS.md")).toBe(true);
			expect(log.lines).not.toContain("step: Next steps");
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
