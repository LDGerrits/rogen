import { jest } from "@jest/globals";
import path from "path";
import "../init-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { CancelledError } from "../../../base/errors.js";
import { ResultError } from "../../../base/result.js";
import { configStructure } from "../../../domain/config/config-structure.js";
import { ConfigFileReader } from "../../../platform/config/config-file.js";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { PromptService } from "../../../platform/prompt/prompt-service.js";
import {
	ACCEPT_DEFAULT,
	CANCEL,
	MockPromptService,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { CommandLine } from "../../../platform/environment/args.js";

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
			options,
		});
	};

	const write = (file: string, content = "") =>
		memFs.writeFile(path.join(cwd, file), content);
	const read = (file: string) => memFs.readFile(path.join(cwd, file));
	const readJson = async (file: string) => JSON.parse(await read(file));
	const exists = (file: string) => memFs.exists(path.join(cwd, file));
	const errorMessage = (result: Awaited<ReturnType<typeof runInit>>) =>
		(result as ResultError<Error>).error.message;

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

		it("should print only the files written, the projects and the next steps as one document", async () => {
			await write("tsconfig.json", "{}");

			const { result, logService } = await runJson();

			expect(result.isOk()).toBe(true);
			expect(logService.entries.map(({ kind }) => kind)).toEqual([
				"print",
			]);
			expect(JSON.parse(logService.entries[0].text)).toEqual({
				changed: true,
				files: [
					{
						file: path.join(cwd, "default.rogen.json"),
						outcome: "wrote",
					},
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
						flag: "--no-agent-rules",
					},
				]),
				directories: [path.join(cwd, "src")],
				projects: [
					{
						config: "default.rogen.json",
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
						'To change where code goes, edit "routes" in default.rogen.json. To place a folder as it is, such as Packages, mount it in its "tree".',
						"Edit default.rogen.json and leave default.project.json alone, since 'rogen write' overwrites it. After you add a feature folder, run 'rogen write' so the editor's default.project.json follows.",
					],
				},
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
					{
						file: path.join(cwd, "default.rogen.json"),
						outcome: "wrote",
					},
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

	describe("decided", () => {
		const flagsByQuestion = async (options: CommandLine["options"]) => {
			const logService = new MockLogService();
			await runInit(new MockPromptService([], false), logService, {
				json: true,
				"dry-run": true,
				...options,
			});
			const { decided } = JSON.parse(logService.entries[0].text);
			return Object.fromEntries(
				decided.map(
					({
						question,
						flag,
					}: {
						question: string;
						flag: string;
					}) => [question, flag]
				)
			);
		};

		it("should name the flag that changes each choice", async () => {
			const flags = await flagsByQuestion({});

			expect(flags).toMatchObject({
				kind: "--kind",
				language: "--language",
				sample: "--no-sample",
				agentRules: "--no-agent-rules",
				places: "--places",
			});
		});

		it("should name --no-places when the default is several places", async () => {
			await write("projects/keep");

			const flags = await flagsByQuestion({ language: "roblox-ts" });

			expect(flags.places).toBe("--no-places");
		});

		it("should name in the text the flags that reproduce the choices instead", async () => {
			const flags = await flagsByQuestion({});
			const logService = new MockLogService();

			await runInit(new MockPromptService([], false), logService);

			const tookDefaults = logService.lines.find((line) =>
				line.includes("Took the defaults")
			);
			expect(tookDefaults).toContain("--no-places, ");
			expect(tookDefaults).toContain("--sample, --agent-rules.");
			expect(flags).toMatchObject({
				places: "--places",
				sample: "--no-sample",
				agentRules: "--no-agent-rules",
			});
		});
	});

	describe("output", () => {
		it("should open with a header, list each file written and close with a result", async () => {
			const logService = new MockLogService();

			await runInit(new MockPromptService([], false), logService);

			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: The Greeter sample is in src/Greeter, and Rojo's sample Baseplate and lighting in place, which the tree mounts. Pass --no-sample for an empty src and no place.",
				"info: Took the defaults: --kind place, --language luau, --no-places, --sample, --agent-rules.",
				"success: Created default.rogen.json.",
				"success: Created .gitignore.",
				"success: Created src/Greeter/Shared/Greeting.luau.",
				"success: Created src/Greeter/Server/Greeter.server.luau.",
				"success: Created src/Greeter/Client/Greeter.client.luau.",
				"success: Created place/Lighting/init.meta.json.",
				"success: Created place/SoundService/init.meta.json.",
				"success: Created place/Workspace/Baseplate.model.json.",
				"success: Created place/Workspace/init.meta.json.",
				"success: Created README.md.",
				"success: Created AGENTS.md.",
				"success: default.project.json · wrote",
				"step: Next steps",
				"info: Run:",
				"info:   rogen serve",
				"info: In Studio, press Connect in the Rojo plugin.",
				'info: To change where code goes, edit "routes" in default.rogen.json. To place a folder as it is, such as Packages, mount it in its "tree".',
				"info: Edit default.rogen.json and leave default.project.json alone, since 'rogen write' overwrites it. After you add a feature folder, run 'rogen write' so the editor's default.project.json follows.",
				"outro: Wrote 11 files.",
			]);
		});
	});

	describe("first write", () => {
		it("should write the project file of the config it wrote", async () => {
			await write("src/Inventory/Server/Save.luau");

			await runInit();

			expect(
				(await readJson("default.project.json")).tree
					.ServerScriptService.Inventory
			).toBeDefined();
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
			expect(await exists("default.rogen.json")).toBe(true);
			expect(logService.lines).not.toContain("step: Next steps");
		});

		it("should list the project of the config in the JSON document", async () => {
			const logService = new MockLogService();

			await runInit(new MockPromptService([], false), logService, {
				json: true,
			});

			expect(JSON.parse(logService.entries[0].text).projects).toEqual([
				{
					config: "default.rogen.json",
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
					"success: Created .agents/hooks/rogen-check.mjs.",
					"success: Created .claude/settings.json.",
				])
			);
			expect(await exists(".agents/hooks/rogen-check.mjs")).toBe(true);
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

			expect(await exists(".agents/hooks/rogen-check.mjs")).toBe(false);
		});
	});

	describe("--dry-run", () => {
		it("should write nothing, and say what it would", async () => {
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService,
				{ "dry-run": true }
			);

			expect(result.isOk()).toBe(true);
			expect(await exists("default.rogen.json")).toBe(false);
			expect(await exists("AGENTS.md")).toBe(false);
			expect(await exists("src")).toBe(false);
			expect(await exists("default.project.json")).toBe(false);
			expect(logService.lines).toEqual([
				"intro: rogen init",
				"info: The Greeter sample is in src/Greeter, and Rojo's sample Baseplate and lighting in place, which the tree mounts. Pass --no-sample for an empty src and no place.",
				"info: Took the defaults: --kind place, --language luau, --no-places, --sample, --agent-rules.",
				"success: Would create default.rogen.json.",
				"success: Would create .gitignore.",
				"success: Would create src/Greeter/Shared/Greeting.luau.",
				"success: Would create src/Greeter/Server/Greeter.server.luau.",
				"success: Would create src/Greeter/Client/Greeter.client.luau.",
				"success: Would create place/Lighting/init.meta.json.",
				"success: Would create place/SoundService/init.meta.json.",
				"success: Would create place/Workspace/Baseplate.model.json.",
				"success: Would create place/Workspace/init.meta.json.",
				"success: Would create README.md.",
				"success: Would create AGENTS.md.",
				"success: Would create src/.",
				"outro: Would write 11 files. Nothing was written.",
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
						file: path.join(cwd, "default.rogen.json"),
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
						file: path.join(cwd, "place/Lighting/init.meta.json"),
						outcome: "wouldWrite",
					},
					{
						file: path.join(
							cwd,
							"place/SoundService/init.meta.json"
						),
						outcome: "wouldWrite",
					},
					{
						file: path.join(
							cwd,
							"place/Workspace/Baseplate.model.json"
						),
						outcome: "wouldWrite",
					},
					{
						file: path.join(cwd, "place/Workspace/init.meta.json"),
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
			expect(document.projects).toBeUndefined();
			expect(await exists("default.rogen.json")).toBe(false);
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
					places: false,
					"agent-rules": false,
					sample: false,
				})
			);

			expect(result.isOk()).toBe(true);
			expect(await exists(".gitignore")).toBe(false);
			expect(await exists("AGENTS.md")).toBe(false);
			expect(JSON.parse(logService.entries[0].text)).not.toHaveProperty(
				"decided"
			);
		});

		it("should add the agent hook when asked to, though it can't ask", async () => {
			await write(".claude/keep");

			await runInit(
				new MockPromptService([], false),
				new MockLogService(),
				{ "agent-hook": true }
			);

			expect(await exists(".agents/hooks/rogen-check.mjs")).toBe(true);
		});

		it("should refuse a hook when no coding agent is missing it", async () => {
			const result = await runInit(
				new MockPromptService([], false),
				new MockLogService(),
				{ "agent-hook": true }
			);

			expect(result.isErr()).toBe(true);
			expect(errorMessage(result)).toContain("There is no hook to add.");
			expect(await exists("default.rogen.json")).toBe(false);
		});

		it("should write Rojo's pin and run no program", async () => {
			const processes = new MockProcessService();
			processes.installed.set("rokit", "/bin/rokit");
			const logService = new MockLogService();

			await runInit(
				new MockPromptService([], false),
				logService,
				{},
				[],
				processes
			);

			expect(await read("rokit.toml")).toBe(
				'[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n'
			);
			expect(
				processes.execs.filter(({ file }) => file === "/bin/rokit")
			).toEqual([]);
			expect(logService.entries.map(({ text }) => text)).toContain(
				"Run 'rokit install' to install Rojo."
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
					lines.indexOf("Created default.rogen.json.")
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
				expect(await exists("default.rogen.json")).toBe(false);
			});
		});
	});

	describe("written files", () => {
		it("should write strict JSON that parses under the config structure", async () => {
			await write(".darklua.json");
			await write("wally.toml");
			await memFs.createDirectory(path.join(cwd, "Packages"));

			await runInit();

			const text = await read("default.rogen.json");
			expect(() => JSON.parse(text)).not.toThrow();
			expect(
				(
					await new ConfigFileReader(memFs, configStructure).read(
						path.join(cwd, "default.rogen.json")
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
	});

	describe("--non-interactive", () => {
		it("should take every default without asking, as a run without a terminal does", async () => {
			const prompts = new MockPromptService([], true);

			const result = await runInit(prompts, new MockLogService(), {
				"non-interactive": true,
			});

			expect(result.isOk()).toBe(true);
			expect(prompts.asked).toEqual([]);
			expect(await exists("default.rogen.json")).toBe(true);
		});
	});

	describe("interactive", () => {
		it("should write what plain init writes when every default is accepted", async () => {
			await write("tsconfig.json", "{}");
			await write("Packages/x.luau");
			await write("wally.toml");
			const prompts = new MockPromptService({});

			const result = await runInit(prompts);
			const interactive = await readJson("default.rogen.json");
			await memFs.delete(path.join(cwd, "default.rogen.json"));
			await runInit();

			expect(result.isOk()).toBe(true);
			expect(interactive).toEqual(await readJson("default.rogen.json"));
		});

		it("should write the answers", async () => {
			const prompts = new MockPromptService([
				"luau",
				"one",
				"customise",
				"luau",
				"several",
				ACCEPT_DEFAULT,
				"yes",
			]);

			await runInit(prompts);

			expect(await exists("default.rogen.json")).toBe(false);
			expect((await readJson("game.rogen.json")).sourcePaths).toEqual([
				"src/common",
				"src/game",
			]);
		});

		it("should write nothing when cancelled", async () => {
			const result = await runInit(new MockPromptService([CANCEL]));

			expect((result as ResultError<Error>).error).toBeInstanceOf(
				CancelledError
			);
			expect(await exists("default.rogen.json")).toBe(false);
		});

		it("should not ask when there is no terminal", async () => {
			const prompts = new MockPromptService([], false);

			const result = await runInit(prompts);

			expect(result.isOk()).toBe(true);
			expect(prompts.asked).toEqual([]);
		});
	});

	describe("project file", () => {
		it("should lift a hand-written default.project.json in a terminal without asking about it", async () => {
			await write("default.project.json", '{"name":"hand-written"}');
			const prompts = new MockPromptService({});

			await runInit(prompts);

			expect(prompts.asked).not.toContain("Project file");
			expect((await readJson("default.rogen.json")).name).toBe(
				"hand-written"
			);
		});
	});

	describe("existing files", () => {
		it("should lift a hand-written default.project.json into default.rogen.json", async () => {
			await write("default.project.json", '{"name":"hand-written"}');
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService
			);

			expect(result.isOk()).toBe(true);
			expect((await readJson("default.rogen.json")).name).toBe(
				"hand-written"
			);
			expect((await readJson("default.project.json")).name).toBe(
				"hand-written"
			);
			expect(logService.lines).toContain(
				"info: Lifting default.project.json into default.rogen.json, since Rogen replaces default.project.json on every write."
			);
		});

		it("should leave another project file alone", async () => {
			await write("lobby.project.json", "{}");

			await runInit();

			expect(await read("lobby.project.json")).toBe("{}");
			expect((await readJson("default.rogen.json")).name).toBeUndefined();
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

	it("should reject several arguments", async () => {
		const result = await runInit(
			new MockPromptService([], false),
			undefined,
			{},
			["lobby", "shop"]
		);

		expect(errorMessage(result)).toBe("init takes one folder.");
		expect(await exists("default.rogen.json")).toBe(false);
	});

	it("should fail on a folder that has a config, and write nothing", async () => {
		await write("default.rogen.json", "{}");

		const result = await runInit(new MockPromptService([], false));

		expect(result.isErr()).toBe(true);
		expect(await read("default.rogen.json")).toBe("{}");
		expect(await exists("AGENTS.md")).toBe(false);
	});

	it("should start a project in a folder", async () => {
		const logService = new MockLogService();

		const result = await runInit(
			new MockPromptService([], false),
			logService,
			{},
			["lobby"]
		);

		expect(result.isOk()).toBe(true);
		expect(await exists("lobby/default.rogen.json")).toBe(true);
		expect(await exists("default.rogen.json")).toBe(false);
		expect(logService.lines).toContain(
			"success: Created lobby/default.rogen.json."
		);
		expect(await exists("lobby/default.project.json")).toBe(true);
	});

	it("should start the next steps by changing into the folder", async () => {
		const logService = new MockLogService();

		await runInit(new MockPromptService([], false), logService, {}, [
			"lobby",
		]);

		const lines = logService.lines;
		const step = lines.indexOf("step: Next steps");
		expect(lines.slice(step + 1, step + 4)).toEqual([
			"info: In each terminal, start in the project folder:",
			"info:   cd lobby",
			"info: Run:",
		]);
	});

	it("should quote a folder that a shell would split", async () => {
		const logService = new MockLogService();

		await runInit(new MockPromptService([], false), logService, {}, [
			"my game",
		]);

		expect(logService.lines).toContain("info:   cd 'my game'");
	});

	it("should not change folder when it ran in the project's own", async () => {
		const logService = new MockLogService();

		await runInit(new MockPromptService([], false), logService);

		expect(logService.lines.join("\n")).not.toContain("cd ");
	});

	it("should name the folder in --json, with the commands left as they are", async () => {
		const logService = new MockLogService();

		await runInit(
			new MockPromptService([], false),
			logService,
			{ json: true },
			["lobby"]
		);

		const { nextSteps } = JSON.parse(logService.entries[0].text);
		expect(nextSteps.directory).toBe("lobby");
		expect(nextSteps.run).toEqual(["rogen serve"]);
	});

	it("should leave the folder out of --json when it ran in the project's own", async () => {
		const logService = new MockLogService();

		await runInit(new MockPromptService([], false), logService, {
			json: true,
		});

		expect(
			JSON.parse(logService.entries[0].text).nextSteps
		).not.toHaveProperty("directory");
	});

	it("should name the sample where the user finds it from here, not from the new folder", async () => {
		const logService = new MockLogService();

		await runInit(new MockPromptService([], false), logService, {}, [
			"lobby",
		]);

		expect(logService.lines).toContain(
			"info: The Greeter sample is in lobby/src/Greeter, and Rojo's sample Baseplate and lighting in lobby/place, which the tree mounts. Pass --no-sample for an empty lobby/src and no lobby/place."
		);
	});
});
