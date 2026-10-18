import { jest } from "@jest/globals";
import path from "path";
import { parse } from "../../../base/jsonc.js";
import "../init-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { CancelledError } from "../../../base/errors.js";
import { ResultError } from "../../../base/result.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { configSchema } from "../../../domain/config/config-schema.js";
import { ConfigFileReader } from "../../../platform/config/config-file.js";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
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

const readyProcesses = () => {
	const processes = new MockProcessService();
	processes.installed.set("rojo", "/bin/rojo");
	processes.outputs.set("/bin/rojo", {
		code: 0,
		stdout: "Rojo 7.7.1\n",
		stderr: "",
	});
	return processes;
};

const WHAT_TO_CHANGE = "What do you want to change?";

describe("init command", () => {
	const cwd = path.resolve("/mock/my-game");
	let memFs: MemoryFileSystemService;

	const runInit = async (
		prompt: PromptService = new MockPromptService([], false),
		log: MockLogService = new MockLogService(),
		options: CommandLine["options"] = {},
		positionals: string[] = [],
		processes: MockProcessService = readyProcesses()
	) => {
		const harness = commandHarness({
			cwd,
			processes,
			fs: memFs,
			log,
			prompt,
			environment: new NativeEnvironmentService(options, cwd),
		});
		return harness.run("init", {
			positionals,
			options: { customise: true, ...options },
		});
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
		const runJson = async () => {
			const logService = new MockLogService();
			const result = await runInit(
				new MockPromptService([], false),
				logService,
				{ json: true }
			);
			return { result, logService };
		};

		it("should print only the files written, the builds and the next steps as one document", async () => {
			await write("tsconfig.json", "{}");

			const { result, logService } = await runJson();

			expect(result.isOk()).toBe(true);
			expect(logService.entries.map(({ kind }) => kind)).toEqual([
				"print",
			]);
			expect(JSON.parse(logService.entries[0].text)).toEqual({
				changed: true,
				files: [
					{ file: path.join(cwd, "rogen.json"), outcome: "wrote" },
					{ file: path.join(cwd, ".gitignore"), outcome: "wrote" },
					{ file: path.join(cwd, "AGENTS.md"), outcome: "wrote" },
				],
				decided: expect.arrayContaining([
					{
						question: "language",
						value: "roblox-ts",
						flag: "--language",
					},
					{
						question: "agentRules",
						value: true,
						flag: "--agent-rules",
					},
				]),
				directories: [path.join(cwd, "src")],
				built: [
					{
						config: "my-game",
						file: path.join(cwd, "rogen.json"),
						projectFile: path.join(cwd, "default.project.json"),
						outcome: "wrote",
						diagnostics: [],
					},
				],
				notes: ["Syncing from out, where roblox-ts compiles to."],
				nextSteps: {
					setup: [],
					run: ["rbxtsc -w", "rogen serve"],
					edits: [
						'Add your own routes under "routes" in rogen.json.',
					],
				},
			});
		});

		it("should list what the project has already as present", async () => {
			await write("rogen.json", "{}");
			await write("AGENTS.md", "<!-- rogen -->\n");

			const { result, logService } = await runJson();

			expect(result.isOk()).toBe(true);
			expect(JSON.parse(logService.entries[0].text)).toMatchObject({
				changed: false,
				files: [],
				present: [
					{
						item: "agentRules",
						file: path.join(cwd, "AGENTS.md"),
						state: "present",
					},
				],
			});
		});

		it("should name the files it wrote before a write failed", async () => {
			await write("tsconfig.json", "{}");
			const writeFile = memFs.writeFile.bind(memFs);
			jest.spyOn(memFs, "writeFile").mockImplementation(
				async (file, content) => {
					if (file.endsWith("AGENTS.md"))
						throw new Error("disk full");
					return writeFile(file, content);
				}
			);

			const { result, logService } = await runJson();

			expect(result.isErr()).toBe(true);
			expect(JSON.parse(logService.entries[0].text)).toEqual({
				changed: true,
				files: [
					{ file: path.join(cwd, "rogen.json"), outcome: "wrote" },
					{ file: path.join(cwd, ".gitignore"), outcome: "wrote" },
				],
				decided: expect.any(Array),
				directories: [],
				error: {
					kind: "io",
					message: "Failed to write AGENTS.md: disk full",
				},
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

			await runInit(new MockPromptService([], false), logService);

			expect(logService.lines).toContain(
				"success: Added Rogen's rules to AGENTS.md."
			);
			expect(await memFs.readFile(path.join(cwd, "AGENTS.md"))).toMatch(
				/^# Rules\n\n<!-- rogen -->\n/
			);
		});

		it("should mark an appended agent file in JSON", async () => {
			await write("CLAUDE.md", "Use tabs.\n");
			const logService = new MockLogService();

			await runInit(new MockPromptService([], false), logService, {
				json: true,
			});

			expect(JSON.parse(logService.entries[0].text).files).toContainEqual(
				{
					file: path.join(cwd, "CLAUDE.md"),
					outcome: "wrote",
					appended: true,
				}
			);
		});
	});

	describe("output", () => {
		it("should open with a header, list each file written and close with a result", async () => {
			const logService = new MockLogService();

			await runInit(new MockPromptService([], false), logService);

			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: Wrote the Greeter sample in src/Greeter, with the Baseplate of Rojo's sample in the tree. Pass --no-sample for an empty src.",
				"info: Took the defaults: --kind place, --language luau, --no-darklua, --no-places, --source-path src, --route server, --route client, --route shared, --unmatched shared, --sample, --agent-rules.",
				"success: Created rogen.json.",
				"success: Created .gitignore.",
				"success: Created src/Greeter/Shared/Greeting.luau.",
				"success: Created src/Greeter/Server/Greeter.server.luau.",
				"success: Created src/Greeter/Client/Greeter.client.luau.",
				"success: Created README.md.",
				"success: Created AGENTS.md.",
				"success: default.project.json · wrote",
				"step: Next steps",
				"info: Run:",
				"info:   rogen serve",
				"info: In Studio, press Connect in the Rojo plugin.",
				'info: Add your own routes under "routes" in rogen.json.',
				"outro: Wrote 7 files.",
			]);
		});

		it("should say only what is there when the config already exists", async () => {
			await write("rogen.json", "{}");
			await write("AGENTS.md", "<!-- rogen -->\n");
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService
			);

			expect(result.isOk()).toBe(true);
			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: AGENTS.md already has Rogen's rules.",
				"outro: Nothing to add.",
			]);
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
			await write("rogen.json", "{}");
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([["agents"], true]),
				logService
			);

			expect(result.isOk()).toBe(true);
			expect(await exists("default.project.json")).toBe(false);
			expect(logService.lines).not.toContainEqual(
				expect.stringContaining("project.json")
			);
		});

		it("should leave out the warning that the compiler has not run yet", async () => {
			await write("tsconfig.json", "{}");
			const logService = new MockLogService();

			await runInit(new MockPromptService([], false), logService);

			expect(
				logService.lines.filter((line) => line.includes("output."))
			).toEqual([]);
		});

		it("should say what is wrong with the routes it wrote", async () => {
			await write("src/Save@sever.luau");
			const logService = new MockLogService();

			await runInit(new MockPromptService([], false), logService);

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
				new MockPromptService([], false),
				logService
			);

			expect(result.isErr()).toBe(true);
			expect(await exists("rogen.json")).toBe(true);
			expect(logService.lines).not.toContain("step: Next steps");
		});

		it("should list the build of the config in the JSON document", async () => {
			const logService = new MockLogService();

			await runInit(new MockPromptService([], false), logService, {
				json: true,
			});

			expect(JSON.parse(logService.entries[0].text).built).toEqual([
				{
					config: "my-game",
					file: path.join(cwd, "rogen.json"),
					projectFile: path.join(cwd, "default.project.json"),
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

			await runInit(accepting(), logService);

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

			await runInit(accepting(), logService);

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

	describe("--dry-run", () => {
		it("should write and build nothing, and say what it would", async () => {
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService,
				{ "dry-run": true }
			);

			expect(result.isOk()).toBe(true);
			expect(await exists("rogen.json")).toBe(false);
			expect(await exists("AGENTS.md")).toBe(false);
			expect(await exists("src")).toBe(false);
			expect(await exists("default.project.json")).toBe(false);
			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: Wrote the Greeter sample in src/Greeter, with the Baseplate of Rojo's sample in the tree. Pass --no-sample for an empty src.",
				"info: Took the defaults: --kind place, --language luau, --no-darklua, --no-places, --source-path src, --route server, --route client, --route shared, --unmatched shared, --sample, --agent-rules.",
				"success: Would create rogen.json.",
				"success: Would create .gitignore.",
				"success: Would create src/Greeter/Shared/Greeting.luau.",
				"success: Would create src/Greeter/Server/Greeter.server.luau.",
				"success: Would create src/Greeter/Client/Greeter.client.luau.",
				"success: Would create README.md.",
				"success: Would create AGENTS.md.",
				"success: Would create src/.",
				"outro: Would write 7 files. Nothing was written.",
			]);
		});

		it("should print the same document with dryRun, wouldWrite and the choices it took", async () => {
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService,
				{ json: true, "dry-run": true }
			);

			expect(result.isOk()).toBe(true);
			const document = JSON.parse(logService.entries[0].text);
			expect(document).toMatchObject({
				changed: false,
				dryRun: true,
				files: [
					{
						file: path.join(cwd, "rogen.json"),
						outcome: "wouldWrite",
					},
					{
						file: path.join(cwd, ".gitignore"),
						outcome: "wouldWrite",
					},
					{
						file: path.join(
							cwd,
							"src/Greeter/Shared/Greeting.luau"
						),
						outcome: "wouldWrite",
					},
					{
						file: path.join(
							cwd,
							"src/Greeter/Server/Greeter.server.luau"
						),
						outcome: "wouldWrite",
					},
					{
						file: path.join(
							cwd,
							"src/Greeter/Client/Greeter.client.luau"
						),
						outcome: "wouldWrite",
					},
					{
						file: path.join(cwd, "README.md"),
						outcome: "wouldWrite",
					},
					{
						file: path.join(cwd, "AGENTS.md"),
						outcome: "wouldWrite",
					},
				],
				directories: [path.join(cwd, "src")],
			});
			expect(document.decided).toContainEqual({
				question: "language",
				value: "luau",
				flag: "--language",
			});
			expect(document.built).toBeUndefined();
			expect(await exists("rogen.json")).toBe(false);
		});

		it("should leave out a directory that already exists", async () => {
			await write("src/keep");
			const logService = new MockLogService();

			await runInit(new MockPromptService([], false), logService, {
				json: true,
				"dry-run": true,
			});

			expect(JSON.parse(logService.entries[0].text).directories).toEqual(
				[]
			);
		});

		it("should say what a folder that has a config has, and write nothing", async () => {
			await write("rogen.json", "{}");
			await write("AGENTS.md", "<!-- rogen -->\n");
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService,
				{ "dry-run": true }
			);

			expect(result.isOk()).toBe(true);
			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: AGENTS.md already has Rogen's rules.",
				"outro: Nothing to add.",
			]);
		});
	});

	describe("choices given as flags", () => {
		const jsonOptions = (options: CommandLine["options"]) => ({
			json: true,
			...options,
		});

		it("should write what the flags say without a terminal, and list nothing they answered", async () => {
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService,
				jsonOptions({
					kind: "place",
					"skip-git": true,
					language: "luau",
					"source-path": ["lib"],
					"agent-rules": false,
					route: ["server"],
					unmatched: "leave",
				})
			);

			expect(result.isOk()).toBe(true);
			const config = await readJson("rogen.json");
			expect(config.sourcePaths).toEqual(["lib"]);
			expect(Object.keys(config.routes)).not.toContain("Client");
			expect(await exists("AGENTS.md")).toBe(false);
			const { decided } = JSON.parse(logService.entries[0].text);
			expect(decided.map(({ flag }: { flag: string }) => flag)).toEqual([
				"--darklua",
			]);
		});

		it("should add the agent hook when asked to, though it can't ask", async () => {
			await write(".claude/keep");

			await runInit(
				new MockPromptService([], false),
				new MockLogService(),
				{ "agent-hook": true }
			);

			expect(await exists(".agents/hooks/rogen-check.sh")).toBe(true);
		});

		it("should refuse a hook when no coding agent is missing it", async () => {
			const result = await runInit(
				new MockPromptService([], false),
				new MockLogService(),
				{ "agent-hook": true }
			);

			expect(result.isErr()).toBe(true);
			expect(errorMessage(result)).toContain("There is no hook to add.");
			expect(await exists("rogen.json")).toBe(false);
		});

		it("should set Rojo up when asked to, though it can't ask", async () => {
			const processes = new MockProcessService();
			processes.installed.set("rokit", "/bin/rokit");
			processes.outputs.set("/bin/rokit", {
				code: 0,
				stdout: "",
				stderr: "",
			});
			const logService = new MockLogService();

			await runInit(
				new MockPromptService([], false),
				logService,
				{ rojo: true },
				[],
				processes
			);

			expect(await read("rokit.toml")).toBe("[tools]\n");
			expect(
				processes.execs.filter(({ file }) => file === "/bin/rokit")
			).toMatchObject([{ args: ["add", "rojo-rbx/rojo@7.7.1"], cwd }]);
		});

		it("should warn with what to run, and still finish, when the command fails", async () => {
			const processes = new MockProcessService();
			processes.installed.set("rokit", "/bin/rokit");
			processes.outputs.set("/bin/rokit", {
				code: 1,
				stdout: "",
				stderr: "ERROR No network\n",
			});
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService,
				{ rojo: true, "studio-plugin": true },
				[],
				processes
			);

			expect(result.isOk()).toBe(true);
			expect(await exists("rogen.json")).toBe(true);
			expect(
				logService.entries.filter(({ kind }) => kind === "warn")
			).toMatchObject([
				{
					text: "rokit add rojo-rbx/rojo@7.7.1 failed (ERROR No network). Run these yourself: rokit add rojo-rbx/rojo@7.7.1, then rojo plugin install.",
				},
			]);
		});

		it("should say what it would run in a dry run, and run nothing", async () => {
			const processes = new MockProcessService();
			processes.installed.set("rokit", "/bin/rokit");
			const logService = new MockLogService();

			await runInit(
				new MockPromptService([], false),
				logService,
				{ rojo: true, "dry-run": true },
				[],
				processes
			);

			expect(processes.execs).toEqual([]);
			expect(logService.entries).toContainEqual(
				expect.objectContaining({
					text: "Would run rokit add rojo-rbx/rojo@7.7.1.",
				})
			);
		});

		describe("a new roblox-ts project", () => {
			const NPM =
				"npm create roblox-ts@latest -- game --dir . --yes --git=false --skipBuild";
			const npmProcesses = (code = 0) => {
				const processes = readyProcesses();
				processes.installed.set("npm", "/bin/npm");
				processes.outputs.set("/bin/npm", {
					code,
					stdout: "",
					stderr: code === 0 ? "" : "npm error network\n",
				});
				return processes;
			};
			const text = (log: MockLogService) =>
				log.entries.map(({ text }) => text);

			it("should say it ran create-roblox-ts before it created any file", async () => {
				const log = new MockLogService();

				const result = await runInit(
					new MockPromptService([], false),
					log,
					{ language: "roblox-ts", "skip-git": true },
					[],
					npmProcesses()
				);

				expect(result.isOk()).toBe(true);
				const lines = text(log);
				expect(lines).toContain(`Ran ${NPM}.`);
				expect(lines.indexOf(`Ran ${NPM}.`)).toBeLessThan(
					lines.indexOf("Created rogen.json.")
				);
			});

			it("should list it among the commands of --json", async () => {
				const log = new MockLogService();

				await runInit(
					new MockPromptService([], false),
					log,
					{ language: "roblox-ts", "skip-git": true, json: true },
					[],
					npmProcesses()
				);

				expect(JSON.parse(log.entries[0].text).commands).toEqual([
					{ command: NPM, outcome: "ran" },
				]);
			});

			it("should say what it would run in a dry run, and run nothing", async () => {
				const log = new MockLogService();
				const processes = npmProcesses();

				await runInit(
					new MockPromptService([], false),
					log,
					{ language: "roblox-ts", "dry-run": true },
					[],
					processes
				);

				expect(text(log)).toContain(`Would run ${NPM}.`);
				expect(processes.execs.map(({ file }) => file)).not.toContain(
					"/bin/npm"
				);
			});

			it("should fail with the command to run by hand, and write nothing", async () => {
				const result = await runInit(
					new MockPromptService([], false),
					new MockLogService(),
					{ language: "roblox-ts" },
					[],
					npmProcesses(1)
				);

				expect(errorMessage(result)).toContain(NPM);
				expect(errorMessage(result)).toContain("npm error network");
				expect(await exists("rogen.json")).toBe(false);
			});
		});

		it("should refuse a language it doesn't know, naming the ones it does", async () => {
			const result = await runInit(
				new MockPromptService([], false),
				new MockLogService(),
				{ language: "lua" }
			);

			expect(errorMessage(result)).toBe(
				"'lua' is not a language. The values of --language are luau and roblox-ts."
			);
			expect(await exists("rogen.json")).toBe(false);
		});

		it("should add only what the flags ask to a folder that has a config", async () => {
			await write("rogen.json", "{}");
			await write(".claude/keep");

			const result = await runInit(
				new MockPromptService([], false),
				new MockLogService(),
				{ "agent-hook": true }
			);

			expect(result.isOk()).toBe(true);
			expect(await exists(".agents/hooks/rogen-check.sh")).toBe(true);
			expect(await exists("AGENTS.md")).toBe(false);
		});

		it("should not add what a flag refuses to a folder that has a config", async () => {
			await write("rogen.json", "{}");

			const result = await runInit(
				new MockPromptService([], false),
				new MockLogService(),
				{ "agent-rules": false }
			);

			expect(diagnosticsOf(result)).toMatchObject([
				{ code: "init.configExists" },
			]);
			expect(await exists("AGENTS.md")).toBe(false);
		});

		describe("on a project that has a config", () => {
			const CONFIG =
				'{\n\t// my routes\n\t"tree": { "$className": "DataModel" },\n\t"routes": { "server": "ServerScriptService", "client": "StarterPlayer/StarterPlayerScripts" }\n}\n';

			const readConfig = async () =>
				parse(await read("rogen.json")).unwrap() as {
					routes: Record<string, string>;
					serveProject?: string;
					projects?: unknown;
				};

			beforeEach(async () => {
				await write("rogen.json", CONFIG);
				await write("src/keep.luau");
			});

			it("should change the routes the flags name and keep the comment", async () => {
				const log = new MockLogService();

				const result = await runInit(
					new MockPromptService([], false),
					log,
					{ route: ["serverStorage"], "no-route": ["client"] }
				);

				expect(result.isOk()).toBe(true);
				const text = await read("rogen.json");
				expect(text).toContain("// my routes");
				expect(text).toContain('"serverStorage": "ServerStorage"');
				expect(text).not.toContain('"client"');
				expect(log.lines).toContain(
					"success: rogen.json: added routes.serverStorage."
				);
				expect(log.lines).toContain(
					"success: rogen.json: removed routes.client."
				);
			});

			it("should list the changes in --json, and write nothing in a dry run", async () => {
				const log = new MockLogService();

				await runInit(new MockPromptService([], false), log, {
					json: true,
					"dry-run": true,
					"source-path": ["lib"],
				});

				expect(JSON.parse(log.entries[0].text).files).toEqual([
					expect.objectContaining({
						outcome: "wouldWrite",
						changes: ["added sourcePaths lib"],
					}),
				]);
				expect(await read("rogen.json")).toBe(CONFIG);
			});

			it("should build the config after changing it", async () => {
				await runInit(new MockPromptService([], false), undefined, {
					darklua: true,
				});

				expect(await exists("dist.project.json")).toBe(true);
				expect(await exists(".darklua.json")).toBe(true);
				expect((await readConfig()).serveProject).toBe("dist");
			});

			it("should take Darklua off again", async () => {
				await runInit(new MockPromptService([], false), undefined, {
					darklua: true,
				});

				await runInit(new MockPromptService([], false), undefined, {
					darklua: false,
				});

				const config = await readConfig();
				expect(config.serveProject).toBeUndefined();
				expect(config.projects).toBeUndefined();
			});

			it("should refuse a flag for a new project, and say why", async () => {
				const result = await runInit(
					new MockPromptService([], false),
					new MockLogService(),
					{ sample: false }
				);

				expect(errorMessage(result)).toContain(
					"--sample is for a new project, and rogen.json exists."
				);
			});

			it("should say a take-off that is not possible instead of changing it", async () => {
				await write(
					"rogen.json",
					'{ "tree": { "$className": "DataModel" }, "routes": { "client": "Elsewhere" } }'
				);

				const result = await runInit(
					new MockPromptService([], false),
					new MockLogService(),
					{ "no-route": ["client"] }
				);

				expect(errorMessage(result)).toContain(
					"goes to Elsewhere, not to the standard"
				);
			});

			it("should ask what to change in a terminal and apply the picks", async () => {
				const prompts = new MockPromptService({
					[WHAT_TO_CHANGE]: ["unmatched"],
					"Files that match no route": "shared",
				});

				const result = await runInit(prompts);

				expect(result.isOk()).toBe(true);
				expect((await readConfig()).routes["*"]).toBe(
					"ReplicatedStorage/Shared"
				);
			});
		});

		it("should do nothing, and succeed, when what a flag asks for is already there", async () => {
			await write("rogen.json", "{}");
			await write("AGENTS.md", "<!-- rogen -->\n");
			await write(
				"rokit.toml",
				'[tools]\nrojo = "rojo-rbx/rojo@7.5.0"\n'
			);
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService,
				{ json: true, "agent-rules": true, rojo: true }
			);

			expect(result.isOk()).toBe(true);
			expect(JSON.parse(logService.entries[0].text)).toMatchObject({
				changed: false,
				files: [],
			});
		});

		it("should refuse the choices of a new config beside one that exists", async () => {
			await write("rogen.json", "{}");

			const result = await runInit(
				new MockPromptService([], false),
				new MockLogService(),
				{ language: "luau", route: ["server"] }
			);

			expect(errorMessage(result)).toContain(
				"--language is for a new project, and rogen.json exists."
			);
		});

		it("should start a project below another one only with --nested", async () => {
			await memFs.createDirectory(path.join(cwd, "game"));
			await memFs.writeFile(path.join(cwd, "rogen.json"), "{}");
			const inner = path.join(cwd, "game");
			const innerRun = (options: CommandLine["options"]) => {
				const harness = commandHarness({
					cwd: inner,
					fs: memFs,
					log: new MockLogService(),
					prompt: new MockPromptService([], false),
					environment: new NativeEnvironmentService(options, inner),
				});
				return harness.run("init", { positionals: [], options });
			};

			const refused = await innerRun({});
			const allowed = await innerRun({ nested: true });

			expect(errorMessage(refused)).toContain("run rogen init --nested");
			expect(allowed.isOk()).toBe(true);
			expect(await memFs.exists(path.join(inner, "rogen.json"))).toBe(
				true
			);
		});
	});

	describe("package mounts", () => {
		it("should mount the packages in the tree of rogen.json and in the project file it writes", async () => {
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();

			const entry = await new CoreConfigService(
				memFs,
				new NativeEnvironmentService({}, cwd)
			).read(path.join(cwd, "rogen.json"));
			expect(entry.status).toBe("valid");
			expect((await readJson("rogen.json")).tree).toMatchObject({
				ReplicatedStorage: { Packages: { $path: "Packages" } },
			});
			expect((await readJson("default.project.json")).tree).toMatchObject(
				{
					ReplicatedStorage: { Packages: { $path: "Packages" } },
				}
			);
		});
	});

	describe("written files", () => {
		it("should write strict JSON that parses under the config schema", async () => {
			await write(".darklua.json");
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();

			const text = await read("rogen.json");
			expect(() => JSON.parse(text)).not.toThrow();
			expect(
				(
					await new ConfigFileReader(memFs, configSchema).read(
						path.join(cwd, "rogen.json")
					)
				).isOk()
			).toBe(true);
		});

		it("should never write into .vscode", async () => {
			await write("tsconfig.json", "{}");
			await write(".darklua.json");

			await runInit();

			expect(await exists(".vscode")).toBe(false);
		});

		it("should write the detected source path without a terminal", async () => {
			await write("lib/Main.luau");

			await runInit();

			expect((await readJson("rogen.json")).sourcePaths).toEqual(["lib"]);
		});

		it("should write one config that serves a project synced from Darklua's output", async () => {
			await write(".darklua.json");

			await runInit();

			const config = await readJson("rogen.json");
			expect(config.serveProject).toBe("dist");
			expect(config.projects).toEqual({ dist: { syncPath: "dist" } });
			expect(config.syncPath).toBeUndefined();
			expect(await exists("sync.rogen.json")).toBe(false);
		});

		it("should write a release project without the specs when a test runner is there", async () => {
			await write("package.json", '{"devDependencies":{"jest":"1"}}');

			await runInit();

			expect((await readJson("rogen.json")).projects).toEqual({
				release: { globIgnorePaths: ["**/*.spec.luau"] },
			});
			expect(await exists("release.project.json")).toBe(true);
		});
	});

	describe("--non-interactive", () => {
		it("should take every default without asking, as a run without a terminal does", async () => {
			const prompts = new MockPromptService([], true);

			const result = await runInit(prompts, new MockLogService(), {
				"non-interactive": true,
			});

			expect(result.isOk()).toBe(true);
			expect(prompts.asked).toEqual([]);
			expect(await exists("rogen.json")).toBe(true);
		});
	});

	describe("interactive", () => {
		it("should write what plain init writes when every default is accepted", async () => {
			await write("tsconfig.json", "{}");
			await write("Packages/x.luau");
			await write("wally.toml");
			const prompts = new MockPromptService({});

			const result = await runInit(prompts);
			const interactive = await readJson("rogen.json");
			await memFs.delete(path.join(cwd, "rogen.json"));
			await runInit();

			expect(result.isOk()).toBe(true);
			expect(interactive).toEqual(await readJson("rogen.json"));
		});

		it("should write the answers", async () => {
			const prompts = new MockPromptService({
				Language: "luau",
				"Does Darklua process your code before Rojo syncs it?": true,
				"Source paths": "src, lib",
				"Sync path": "out",
				Routes: [],
			});

			await runInit(prompts);

			const config = await readJson("rogen.json");
			expect(config.sourcePaths).toEqual(["src", "lib"]);
			expect(config.projects).toEqual({ dist: { syncPath: "out" } });
		});

		it("should not head next steps when adding the agent rules leaves none", async () => {
			await write("rogen.json", "{}");
			const log = new MockLogService();

			await runInit(
				new MockPromptService({ [WHAT_TO_CHANGE]: ["agents"] }),
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

			await runInit(prompts);

			expect((await readJson("rogen.json")).routes).toEqual({
				Server: "ServerScriptService",
				StarterGui: "StarterGui",
			});
		});

		it("should take the source path placeholder from the code it finds", async () => {
			await write("game/Main.server.luau");
			const prompts = new MockPromptService({});

			await runInit(prompts);

			expect((await readJson("rogen.json")).sourcePaths).toEqual([
				"game",
			]);
		});

		it("should mount a folder that is not installed as optional", async () => {
			await write("wally.toml");
			const prompts = new MockPromptService({ Packages: ["Packages"] });

			await runInit(prompts);

			expect(
				(await readJson("rogen.json")).tree.ReplicatedStorage
			).toEqual({ Packages: { $path: { optional: "Packages" } } });
		});

		it("should ask seven questions on a bare Luau folder, none of them about packages", async () => {
			const prompts = new MockPromptService({});

			await runInit(prompts);

			expect(prompts.asked).toEqual([
				"Language",
				"Does Darklua process your code before Rojo syncs it?",
				"One place or several?",
				"Source paths",
				"Routes",
				"Files that match no route",
				expect.stringContaining("Rogen's rules for coding agents"),
			]);
		});

		it("should still ask about packages when a manifest is there", async () => {
			await write("wally.toml");
			const prompts = new MockPromptService({});

			await runInit(prompts);

			expect(prompts.asked).toContain("Packages");
		});

		it("should write nothing when cancelled", async () => {
			const result = await runInit(new MockPromptService([CANCEL]));

			expect((result as ResultError<Error>).error).toBeInstanceOf(
				CancelledError
			);
			expect(await exists("rogen.json")).toBe(false);
		});

		it("should not ask when there is no terminal", async () => {
			const prompts = new MockPromptService([], false);

			const result = await runInit(prompts);

			expect(result.isOk()).toBe(true);
			expect(prompts.asked).toEqual([]);
		});
	});

	describe("project file", () => {
		it("should ask whether to lift a hand-written default.project.json", async () => {
			await write("default.project.json", '{"name":"hand-written"}');
			const prompts = new MockPromptService({});

			await runInit(prompts);

			expect(prompts.asked).toContain("Project file");
			expect((await readJson("rogen.json")).name).toBe("hand-written");
		});

		it("should start a new tree when that is the answer", async () => {
			await write("default.project.json", '{"name":"hand-written"}');
			const prompts = new MockPromptService({ "Project file": "new" });

			await runInit(prompts);

			expect((await readJson("rogen.json")).name).toBeUndefined();
		});
	});

	describe("existing files", () => {
		it("should report what is there and leave the config alone when nothing is left to add", async () => {
			await write("rogen.json", "{}");
			await write("AGENTS.md", "<!-- rogen -->\n");

			const result = await runInit();

			expect(result.isOk()).toBe(true);
			expect(await read("rogen.json")).toBe("{}");
		});

		it("should fail naming the config when the flags leave nothing to add and nothing is there", async () => {
			await write("rogen.json", "{}");

			const result = await runInit(
				new MockPromptService([], false),
				new MockLogService(),
				{ "agent-rules": false }
			);

			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(cwd, "rogen.json"),
				},
			]);
		});

		it("should report the hook and the rules as there when a second run asks for them", async () => {
			await write("rogen.json", "{}");
			await write("AGENTS.md", "<!-- rogen -->\n");
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService,
				{ "agent-rules": true }
			);

			expect(result.isOk()).toBe(true);
			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: AGENTS.md already has Rogen's rules.",
				"outro: Nothing to add.",
			]);
		});

		it("should add the agent rules beside a config when it can't ask, and leave the config alone", async () => {
			await write("rogen.json", "{}");

			const result = await runInit();

			expect(result.isOk()).toBe(true);
			expect(await read("rogen.json")).toBe("{}");
			expect(await exists("AGENTS.md")).toBe(true);
		});

		it("should lift a hand-written default.project.json into rogen.json", async () => {
			await write("default.project.json", '{"name":"hand-written"}');
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService
			);

			expect(result.isOk()).toBe(true);
			expect((await readJson("rogen.json")).name).toBe("hand-written");
			expect((await readJson("default.project.json")).name).toBe(
				"hand-written"
			);
			expect(logService.lines).toContain(
				"info: Lifting default.project.json into rogen.json, since Rogen replaces default.project.json on every build."
			);
		});

		it("should leave another project file alone", async () => {
			await write("lobby.project.json", "{}");

			await runInit();

			expect(await read("lobby.project.json")).toBe("{}");
			expect((await readJson("rogen.json")).name).toBeUndefined();
		});
	});

	it("should return a structured error if writing a file fails", async () => {
		jest.spyOn(memFs, "writeFile").mockRejectedValue(
			new Error("Permission denied")
		);

		const result = await runInit();

		expect(result.isErr()).toBe(true);
		expect(errorMessage(result)).toContain("Failed to write rogen.json");
		expect(errorMessage(result)).toContain("Permission denied");
	});

	it("should reject several arguments", async () => {
		const result = await runInit(
			new MockPromptService([], false),
			undefined,
			{},
			["lobby", "shop"]
		);

		expect(errorMessage(result)).toBe(
			"init takes one folder, the place to add."
		);
		expect(await exists("rogen.json")).toBe(false);
	});

	it("should start a project in a folder when no config is at or above it", async () => {
		const logService = new MockLogService();

		const result = await runInit(
			new MockPromptService([], false),
			logService,
			{},
			["lobby"]
		);

		expect(result.isOk()).toBe(true);
		expect(await exists("lobby/rogen.json")).toBe(true);
		expect(await exists("rogen.json")).toBe(false);
		expect(logService.lines).toContain(
			"info: No rogen.json is at or above lobby, so init starts a project there."
		);
		expect(logService.lines).toContain(
			"success: Created lobby/rogen.json."
		);
		expect(await exists("lobby/default.project.json")).toBe(true);
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
