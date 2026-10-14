import { jest } from "@jest/globals";
import path from "path";
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

const WHAT_TO_ADD = "rogen.json exists. What do you want to add?";

describe("init command", () => {
	const cwd = path.resolve("/mock/my-game");
	let memFs: MemoryFileSystemService;

	const runInit = async (
		prompt: PromptService = new MockPromptService([], false),
		log: MockLogService = new MockLogService(),
		options: CommandLine["options"] = {},
		positionals: string[] = []
	) => {
		const harness = commandHarness({
			cwd,
			fs: memFs,
			log,
			prompt,
			environment: new NativeEnvironmentService(options, cwd),
		});
		return harness.run("init", { positionals, options });
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
				appended: [],
				files: [
					path.join(cwd, "rogen.json"),
					path.join(cwd, "AGENTS.md"),
				],
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
					darklua: [],
					edits: [
						'Add your own routes under "routes" in rogen.json.',
					],
				},
			});
		});

		it("should print nothing and return the failure", async () => {
			await write("rogen.json", "{}");
			await write("AGENTS.md", "<!-- rogen -->\n");

			const { result, logService } = await runJson();

			expect(diagnosticsOf(result)).toMatchObject([
				{ code: "init.configExists" },
			]);
			expect(logService.entries).toEqual([]);
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
				appended: [],
				files: [path.join(cwd, "rogen.json")],
				directories: [],
				error: "Failed to write AGENTS.md: disk full",
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

		it("should list an appended agent file under appended in JSON", async () => {
			await write("CLAUDE.md", "Use tabs.\n");
			const logService = new MockLogService();

			await runInit(new MockPromptService([], false), logService, {
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

			await runInit(new MockPromptService([], false), logService);

			expect(logService.lines).toEqual([
				"intro: rogen init",
				"success: Created rogen.json.",
				"success: Created AGENTS.md.",
				"success: Created src/.",
				"success: default.project.json · wrote",
				"step: Next steps",
				"info: Run:",
				"info:   rogen serve",
				'info: Add your own routes under "routes" in rogen.json.',
				"outro: Wrote 2 files.",
			]);
		});

		it("should print nothing after the header when the config already exists", async () => {
			await write("rogen.json", "{}");
			await write("AGENTS.md", "<!-- rogen -->\n");
			const logService = new MockLogService();

			const result = await runInit(
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
			await write("rogen.json", "{}");
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService(["agent"]),
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

	describe("git", () => {
		const accepting = () =>
			new MockPromptService({
				"Keep the project files Rogen writes out of git?": true,
			});

		it("should add the files it will write to the .gitignore here, anchored to this folder", async () => {
			await write(".gitignore", "node_modules/\n");

			await runInit(accepting());

			expect(await read(".gitignore")).toBe(
				"node_modules/\n\n# Written by Rogen from rogen.json\n/default.project.json\n/sourcemap.json\n"
			);
		});

		it("should add a project file for each project", async () => {
			await write(".gitignore", "");
			await write("package.json", '{"devDependencies":{"jest":"1"}}');

			await runInit(accepting());

			expect(await read(".gitignore")).toContain(
				"/release.project.json\n"
			);
		});

		it("should never ignore project files by a pattern", async () => {
			await write(".gitignore", "");
			await write("package.json", '{"devDependencies":{"jest":"1"}}');

			await runInit(accepting());

			expect(await read(".gitignore")).not.toContain("*");
		});

		it("should create a .gitignore in a folder that is in a git repository", async () => {
			await memFs.createDirectory(path.join(cwd, ".git"));

			await runInit(accepting());

			expect(await read(".gitignore")).toBe(
				"# Written by Rogen from rogen.json\n/default.project.json\n/sourcemap.json\n"
			);
		});

		it("should find the repository in a folder above", async () => {
			await memFs.createDirectory(path.join(path.dirname(cwd), ".git"));

			await runInit(accepting());

			expect(await exists(".gitignore")).toBe(true);
		});

		it("should write no .gitignore outside a repository", async () => {
			await runInit(new MockPromptService({}));

			expect(await exists(".gitignore")).toBe(false);
		});

		it("should leave a .gitignore that ignores the files already as it is", async () => {
			const text = "/default.project.json\n/sourcemap.json\n";
			await write(".gitignore", text);

			await runInit(accepting());

			expect(await read(".gitignore")).toBe(text);
		});

		it("should say it added them", async () => {
			await write(".gitignore", "");
			const log = new MockLogService();

			await runInit(accepting(), log);

			expect(log.texts("success")).toContain(
				"Added the files Rogen writes to .gitignore."
			);
		});
	});

	describe("--non-interactive", () => {
		it("should take every default without asking, as a run without a terminal does", async () => {
			await write(".gitignore", "");
			const prompts = new MockPromptService([], true);

			const result = await runInit(prompts, new MockLogService(), {
				"non-interactive": true,
			});

			expect(result.isOk()).toBe(true);
			expect(prompts.asked).toEqual([]);
			expect(await exists("rogen.json")).toBe(true);
		});

		it("should leave the .gitignore alone, since it edits the repo's tooling", async () => {
			await write(".gitignore", "node_modules/\n");

			await runInit(
				new MockPromptService([], true),
				new MockLogService(),
				{
					"non-interactive": true,
				}
			);

			expect(await read(".gitignore")).toBe("node_modules/\n");
		});

		it("should leave the .gitignore alone without a terminal", async () => {
			await memFs.createDirectory(path.join(cwd, ".git"));

			await runInit();

			expect(await exists(".gitignore")).toBe(false);
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

		it("should ask before it changes the .gitignore, and leave it when the answer is no", async () => {
			await write(".gitignore", "node_modules/\n");
			const prompts = new MockPromptService({
				"Keep the project files Rogen writes out of git?": false,
			});

			await runInit(prompts);

			expect(prompts.asked).toContain(
				"Keep the project files Rogen writes out of git?"
			);
			expect(await read(".gitignore")).toBe("node_modules/\n");
		});

		it("should not ask about git outside a repository", async () => {
			const prompts = new MockPromptService({});

			await runInit(prompts);

			expect(prompts.asked).not.toContain(
				"Keep the project files Rogen writes out of git?"
			);
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

		it("should ask six questions on a bare Luau folder, none of them about packages", async () => {
			const prompts = new MockPromptService({});

			await runInit(prompts);

			expect(prompts.asked).toEqual([
				"Language",
				"Does Darklua process your code before Rojo syncs it?",
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
		it("should fail when the config exists and nothing is left to add, and leave it alone", async () => {
			await write("rogen.json", "{}");
			await write("AGENTS.md", "<!-- rogen -->\n");

			const result = await runInit();

			expect(result.isErr()).toBe(true);
			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(cwd, "rogen.json"),
				},
			]);
			expect(await read("rogen.json")).toBe("{}");
		});

		it("should print nothing after the header when nothing is left to add", async () => {
			await write("rogen.jsonc", "{}");
			await write("AGENTS.md", "<!-- rogen -->\n");
			const logService = new MockLogService();

			const result = await runInit(
				new MockPromptService([], false),
				logService
			);

			expect(result.isErr()).toBe(true);
			expect(logService.lines).toEqual(["intro: rogen init"]);
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

	it("should reject an argument", async () => {
		const result = await runInit(
			new MockPromptService([], false),
			undefined,
			{},
			["lobby"]
		);

		expect(errorMessage(result)).toBe("init takes no arguments.");
		expect(await exists("rogen.json")).toBe(false);
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
