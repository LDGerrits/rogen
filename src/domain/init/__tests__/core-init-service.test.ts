import { agentBlock } from "../agent/agent-block.js";
import { hookScript } from "../agent/hook-script.js";
import { PlannedFile } from "../../toolchain/toolchain.js";
import { jest } from "@jest/globals";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import path from "path";
import { ResultError } from "../../../base/result.js";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	ACCEPT_DEFAULT,
	CANCEL,
	MockPromptService,
	PromptScript,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { PromptService } from "../../../platform/prompt/prompt-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { CoreInitService } from "../core-init-service.js";
import { InitPlan, InitWritten } from "../init-service.js";

const WHAT_TO_ADD = "rogen.json exists. What do you want to add?";
const directory = path.resolve("/mock/my-game");

const ROJO_VERSION = { code: 0, stdout: "Rojo 7.7.1\n", stderr: "" };

describe("CoreInitService", () => {
	let fileSystem: MemoryFileSystemService;
	let processes: MockProcessService;

	beforeEach(async () => {
		fileSystem = new MemoryFileSystemService();
		processes = new MockProcessService();
		processes.installed.set("rojo", "/bin/rojo");
		processes.outputs.set("/bin/rojo", ROJO_VERSION);
		await fileSystem.createDirectory(directory);
	});

	const serviceFor = (
		promptService: PromptService = new MockPromptService([], false),
		cwd = directory
	) => {
		const environmentService = new NativeEnvironmentService({}, cwd);
		return new CoreInitService(
			fileSystem,
			promptService,
			environmentService,
			new CoreToolchainService(fileSystem),
			new CoreConfigService(fileSystem, environmentService),
			processes
		);
	};

	const write = (file: string, content = "") =>
		fileSystem.writeFile(path.join(directory, file), content);

	describe("plan, before it asks", () => {
		it("should read the directory's toolchain", async () => {
			await write("tsconfig.json", "{}");

			const plan = (await serviceFor().plan()).unwrap();

			const config = plan?.files.find(
				({ fileName }) => fileName === "rogen.json"
			);
			expect(JSON.parse(config?.content ?? "{}").routes).toHaveProperty(
				"server"
			);
		});

		it("should take every default without asking when it may not ask, even in a terminal", async () => {
			const interactive = new MockPromptService([], true);

			const plan = (
				await serviceFor(interactive).plan({ ask: false })
			).unwrap();
			const unasked = (await serviceFor().plan()).unwrap();

			expect(plan?.files).toEqual(unasked?.files);
		});

		it("should fail when the directory can't be read", async () => {
			const result = await serviceFor(
				undefined,
				path.join(directory, "missing")
			).plan();

			expect(result.isErr()).toBe(true);
		});
	});

	describe("in a folder below a config", () => {
		const nested = path.join(directory, "src", "Inventory");

		beforeEach(async () => {
			await fileSystem.createDirectory(path.join(directory, "src"));
			await fileSystem.createDirectory(nested);
			await write("rogen.json", "{}");
		});

		it("should refuse, naming the folder that has the config, when it may not ask", async () => {
			const result = await serviceFor(undefined, nested).plan();

			const message = (result as ResultError<Error>).error.message;
			expect(message).toContain(`${directory} already has rogen.json`);
			expect(message).toContain("run rogen from there: cd");
		});

		it("should refuse in a terminal that is told not to ask", async () => {
			const result = await serviceFor(
				new MockPromptService([], true),
				nested
			).plan({ ask: false });

			expect(result.isErr()).toBe(true);
		});

		it("should ask first in a terminal, and go on when the user says yes", async () => {
			const prompts = new MockPromptService({
				[`${directory} already has rogen.json. Start a separate project here anyway?`]: true,
			});

			const result = await serviceFor(prompts, nested).plan();

			expect(prompts.asked[0]).toContain("rogen.json");
			expect(
				result.unwrap()?.files.map(({ fileName }) => fileName)
			).toContain("rogen.json");
		});

		it("should resolve to nothing when the user says no", async () => {
			const prompts = new MockPromptService([false]);

			const result = await serviceFor(prompts, nested).plan();

			expect(result.unwrap()).toBeUndefined();
		});

		it("should not ask or refuse once the folder has a config of its own", async () => {
			await fileSystem.writeFile(path.join(nested, "rogen.json"), "{}");
			const prompts = new MockPromptService([]);

			const result = await serviceFor(prompts, nested).plan({
				ask: false,
			});

			expect(result.isOk()).toBe(true);
		});
	});

	describe("agent instructions", () => {
		const agentFile = async (prompts?: PromptService) => {
			const plan = (
				await serviceFor(prompts).plan({ choices: { sample: false } })
			).unwrap();
			return plan?.files.find(({ fileName }) => fileName.endsWith(".md"));
		};

		it("should write a new AGENTS.md with the block when there is neither file", async () => {
			const file = await agentFile();

			expect(file).toEqual({
				fileName: "AGENTS.md",
				content: agentBlock,
			});
		});

		it("should append to AGENTS.md after a blank line, keeping every byte", async () => {
			await write("AGENTS.md", "# Team rules\n\nBe kind.");
			await write("CLAUDE.md", "@AGENTS.md\n");

			const file = await agentFile();

			expect(file).toEqual({
				fileName: "AGENTS.md",
				content: `# Team rules\n\nBe kind.\n\n${agentBlock}`,
				addition: "Rogen's rules",
			});
		});

		it("should append to a lone CLAUDE.md", async () => {
			await write("CLAUDE.md", "Use tabs.\n");

			expect(await agentFile()).toEqual({
				fileName: "CLAUDE.md",
				content: `Use tabs.\n\n${agentBlock}`,
				addition: "Rogen's rules",
			});
		});

		it("should leave a file that holds the block alone, and not ask", async () => {
			await write("AGENTS.md", `${agentBlock}`);

			expect(await agentFile(new MockPromptService({}))).toBeUndefined();
		});

		it("should leave both files alone when CLAUDE.md holds the block", async () => {
			await write("AGENTS.md", "# Rules\n");
			await write("CLAUDE.md", agentBlock);

			expect(await agentFile()).toBeUndefined();
		});

		it("should fail rather than write over an agent file it can't read", async () => {
			await write("AGENTS.md", "# Rules\n");
			jest.spyOn(fileSystem, "readFile").mockRejectedValueOnce(
				new Error("busy")
			);

			const result = await serviceFor().plan();

			expect((result as ResultError<Error>).error.message).toBe(
				"Failed to read AGENTS.md: busy"
			);
		});

		it("should say to import AGENTS.md when CLAUDE.md doesn't", async () => {
			await write("AGENTS.md", "");
			await write("CLAUDE.md", "Use tabs.\n");

			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.nextSteps.edits[0]).toBe(
				"Add @AGENTS.md to CLAUDE.md, so Claude Code reads Rogen's rules."
			);
		});

		it("should offer it beside a config, and write only it", async () => {
			await write("rogen.json", "{}");

			const plan = (
				await serviceFor(new MockPromptService(["agent"])).plan()
			).unwrap();

			expect(plan?.files.map(({ fileName }) => fileName)).toEqual([
				"AGENTS.md",
			]);
			expect(plan?.configs).toEqual([]);
		});

		it("should not add the hook beside a config when it can't ask", async () => {
			await write("rogen.json", "{}");
			await write("AGENTS.md", agentBlock);
			await write(".claude/keep", "");

			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.files).toEqual([]);
			expect(plan?.present).toEqual([
				{ item: "agentRules", file: "AGENTS.md" },
			]);
		});

		it("should add it beside a config when it can't ask, as Enter would", async () => {
			await write("rogen.jsonc", "{}");

			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.files.map(({ fileName }) => fileName)).toEqual([
				"AGENTS.md",
			]);
		});
	});

	describe("additions from a place", () => {
		const place = path.join(directory, "places/lobby");

		beforeEach(async () => {
			await write(
				"rogen.json",
				JSON.stringify({ placePaths: ["places/*"] })
			);
			await write("places/lobby/rogen.json", "{}");
		});

		it("should add the agent rules to the project root, not to the place", async () => {
			const plan = (await serviceFor(undefined, place).plan()).unwrap();

			expect(plan?.directory).toBe(directory);
			expect(plan?.files.map(({ fileName }) => fileName)).toEqual([
				"AGENTS.md",
			]);
			expect(plan?.notes.join("\n")).toContain(
				"../../rogen.json lists this folder as a place"
			);
		});

		it("should report the rules the root has, and write nothing", async () => {
			await write("AGENTS.md", agentBlock);

			const plan = (await serviceFor(undefined, place).plan()).unwrap();

			expect(plan?.files).toEqual([]);
			expect(plan?.present).toEqual([
				{ item: "agentRules", file: "AGENTS.md" },
			]);
		});

		it("should find the root's hook and Rojo pin", async () => {
			await write("AGENTS.md", agentBlock);
			await write(
				"rokit.toml",
				'[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n'
			);
			await write(
				".claude/settings.json",
				JSON.stringify({
					hooks: {
						Stop: [
							{
								hooks: [
									{
										type: "command",
										command:
											'bash "$CLAUDE_PROJECT_DIR"/.agents/hooks/rogen-check.sh',
									},
								],
							},
						],
					},
				})
			);

			const plan = (await serviceFor(undefined, place).plan()).unwrap();

			expect(plan?.present).toEqual([
				{ item: "agentRules", file: "AGENTS.md" },
				{ item: "agentHook", file: ".claude/settings.json" },
				{ item: "rojo", file: "rokit.toml" },
			]);
		});

		it("should add the agent rules to the place's own folder when no root lists it", async () => {
			await write("rogen.json", "{}");

			const plan = (await serviceFor(undefined, place).plan()).unwrap();

			expect(plan?.directory).toBe(place);
		});
	});

	describe("what to add", () => {
		const valuesListed = async (existing: string[]) => {
			await write("rogen.json", "{}");
			for (const file of existing) await write(file);
			const prompts = new MockPromptService([CANCEL]);
			let values: string[] = [];
			const original = prompts.select.bind(prompts);
			prompts.select = ((options: Parameters<typeof original>[0]) => {
				values = options.choices.map(({ value }) => value);
				return original(options);
			}) as typeof prompts.select;
			await serviceFor(prompts).plan();
			return values;
		};

		it("should offer agent instructions until they are there", async () => {
			expect(await valuesListed([])).toEqual(["agent"]);
			expect(await valuesListed(["AGENTS.md"])).toContain("agent");
		});

		it("should offer the hook only where an agent is in use", async () => {
			expect(await valuesListed([])).not.toContain("hook");
			expect(await valuesListed([".claude/keep"])).toContain("hook");
		});
	});

	describe("agent hook", () => {
		const SCRIPT = ".agents/hooks/rogen-check.sh";
		const CLAUDE = ".claude/settings.json";
		const CODEX = ".codex/hooks.json";
		const answersEverything = () => new MockPromptService({});
		const names = (plan: { files: readonly PlannedFile[] } | undefined) =>
			plan?.files.map(({ fileName }) => fileName);
		const planned = async (prompts = answersEverything()) =>
			(
				await serviceFor(prompts).plan({ choices: { sample: false } })
			).unwrap();
		const fileOf = (
			plan: { files: readonly PlannedFile[] } | undefined,
			name: string
		) => plan?.files.find(({ fileName }) => fileName === name);

		it("should offer it where an agent is in use, and write the script and the agent's file", async () => {
			await write(".claude/keep", "");

			const plan = await planned();

			expect(names(plan)).toEqual([
				"rogen.json",
				".gitignore",
				"AGENTS.md",
				"CLAUDE.md",
				SCRIPT,
				CLAUDE,
			]);
			expect(fileOf(plan, SCRIPT)).toMatchObject({ content: hookScript });
			expect(JSON.parse(fileOf(plan, CLAUDE)?.content ?? "")).toEqual({
				hooks: {
					Stop: [
						{
							hooks: [
								{
									type: "command",
									command:
										'bash "$CLAUDE_PROJECT_DIR"/.agents/hooks/rogen-check.sh',
								},
							],
						},
					],
				},
			});
		});

		it("should write a CLAUDE.md that imports AGENTS.md where Claude Code is in use and has none", async () => {
			await write(".claude/keep", "");

			const plan = await planned();

			expect(fileOf(plan, "CLAUDE.md")?.content).toBe("@AGENTS.md\n");
		});

		it("should leave CLAUDE.md out where there is one, or no Claude Code", async () => {
			await write(".claude/keep", "");
			await write("CLAUDE.md", "Use tabs.\n");
			const withFile = await planned();
			await fileSystem.delete(path.join(directory, "CLAUDE.md"));
			await fileSystem.delete(path.join(directory, ".claude"), true);
			await write(".codex/keep", "");
			const withoutClaude = await planned();

			expect(fileOf(withFile, "CLAUDE.md")?.content).toContain(
				"Use tabs"
			);
			expect(fileOf(withoutClaude, "CLAUDE.md")).toBeUndefined();
		});

		it("should write one script and a file for each agent in use", async () => {
			await write(".claude/keep", "");
			await write(".codex/keep", "");
			await write("GEMINI.md", "");
			await write(".cursor/keep", "");
			await write(".github/copilot-instructions.md", "");

			const plan = await planned();

			expect(names(plan)).toEqual([
				"rogen.json",
				".gitignore",
				"AGENTS.md",
				"CLAUDE.md",
				SCRIPT,
				CLAUDE,
				CODEX,
				".gemini/settings.json",
				".cursor/hooks.json",
				".github/hooks/rogen.json",
			]);
		});

		it.each([
			["CLAUDE.md", CLAUDE],
			["GEMINI.md", ".gemini/settings.json"],
			[".github/copilot-instructions.md", ".github/hooks/rogen.json"],
		])("should take %s as a sign of its agent", async (sign, file) => {
			await write(sign, "Use tabs.\n");

			expect(names(await planned())).toContain(file);
		});

		it("should not offer it where nothing says an agent is in use", async () => {
			const prompts = answersEverything();

			const plan = await planned(prompts);

			expect(names(plan)).not.toContain(SCRIPT);
			expect(
				prompts.asked.filter((message) => message.includes("hook"))
			).toEqual([]);
		});

		it("should not write it in a run that can't ask", async () => {
			await write(".claude/keep", "");

			const plan = (await serviceFor().plan()).unwrap();

			expect(names(plan)).not.toContain(SCRIPT);
		});

		it("should name the agents in the question", async () => {
			await write(".claude/keep", "");
			await write(".codex/keep", "");
			const prompts = answersEverything();

			await planned(prompts);

			expect(prompts.asked.at(-1)).toBe(
				"Add a hook that reports Rogen warnings to Claude Code and Codex?"
			);
		});

		it("should not write it when the question is declined", async () => {
			await write(".claude/keep", "");
			const declined = new MockPromptService({
				"Add a hook that reports Rogen warnings to Claude Code?": false,
			});

			const plan = await planned(declined);

			expect(names(plan)).not.toContain(SCRIPT);
		});

		it("should register it in a file that exists, keeping what it holds", async () => {
			await write(
				CLAUDE,
				JSON.stringify({ model: "opus" }, null, 2) + "\n"
			);

			const plan = await planned();
			const settings = fileOf(plan, CLAUDE);

			expect(settings).toMatchObject({
				addition: "the Rogen hook",
			});
			expect(JSON.parse(settings?.content ?? "")).toMatchObject({
				model: "opus",
				hooks: { Stop: [expect.anything()] },
			});
		});

		it("should skip an agent whose file names the script, and still write the others", async () => {
			await write(
				CLAUDE,
				JSON.stringify({
					hooks: {
						Stop: [{ hooks: [{ command: "x/rogen-check.sh" }] }],
					},
				})
			);
			await write(".codex/keep", "");

			const plan = await planned();

			expect(names(plan)).toEqual([
				"rogen.json",
				".gitignore",
				"AGENTS.md",
				"CLAUDE.md",
				SCRIPT,
				CODEX,
			]);
		});

		it("should not offer it when every agent in use has it", async () => {
			await write(
				CLAUDE,
				JSON.stringify({
					hooks: {
						Stop: [{ hooks: [{ command: "x/rogen-check.sh" }] }],
					},
				})
			);

			expect(names(await planned())).not.toContain(SCRIPT);
		});

		it("should register a new agent without writing over a script that exists", async () => {
			await write(SCRIPT, "#!/bin/sh\n");
			await write(".codex/keep", "");

			const plan = await planned();

			expect(names(plan)).toEqual([
				"rogen.json",
				".gitignore",
				"AGENTS.md",
				CODEX,
			]);
		});

		it("should leave a file that is not plain JSON alone, and say so", async () => {
			await write(CLAUDE, "{ // mine\n}");
			await write(".codex/keep", "");

			const plan = await planned();

			expect(names(plan)).toEqual([
				"rogen.json",
				".gitignore",
				"AGENTS.md",
				"CLAUDE.md",
				SCRIPT,
				CODEX,
			]);
			expect(plan?.notes).toEqual([
				".claude/settings.json isn't plain JSON, so it was left alone. Register .agents/hooks/rogen-check.sh in it by hand: https://rogen-playfully.vercel.app/docs/v2/agents",
			]);
		});

		it("should not offer it when the only file is not plain JSON, but still say so", async () => {
			await write(CLAUDE, "{ // mine\n}");

			const plan = await planned();

			expect(names(plan)).not.toContain(SCRIPT);
			expect(plan?.notes).toEqual([
				".claude/settings.json isn't plain JSON, so it was left alone. Register .agents/hooks/rogen-check.sh in it by hand: https://rogen-playfully.vercel.app/docs/v2/agents",
			]);
		});

		it("should say what the script needs, and what an agent asks of the user", async () => {
			await write(".claude/keep", "");
			await write(".codex/keep", "");

			const plan = await planned();

			expect(plan?.nextSteps.setup).toEqual([
				"The hook needs bash, git and jq; on Windows, winget install jqlang.jq.",
				"Codex runs a new hook only once you trust it: open /hooks in Codex to review it.",
			]);
		});

		it("should list it beside rogen.json, and write only it", async () => {
			await write("rogen.json", "{}");
			await write("AGENTS.md", agentBlock);
			await write(".claude/keep", "");

			const plan = (
				await serviceFor(new MockPromptService(["hook"])).plan()
			).unwrap();

			expect(names(plan)).toEqual([SCRIPT, CLAUDE]);
		});

		it("should fail rather than write over a file it can't read", async () => {
			await write(CLAUDE, "{}");
			jest.spyOn(fileSystem, "readFile").mockRejectedValueOnce(
				new Error("busy")
			);

			const result = await serviceFor(answersEverything()).plan();

			expect((result as ResultError<Error>).error.message).toBe(
				"Failed to read .claude/settings.json: busy"
			);
		});
	});

	describe("Darklua", () => {
		const DARKLUA_PIN = "seaofvoices/darklua@0.19.0";
		const planWithDarklua = async () =>
			(
				await serviceFor().plan({
					ask: false,
					choices: { darklua: true },
				})
			).unwrap();
		const names = (plan: { files: readonly PlannedFile[] } | undefined) =>
			plan?.files.map(({ fileName }) => fileName);
		const fileOf = (
			plan: { files: readonly PlannedFile[] } | undefined,
			name: string
		) => plan?.files.find(({ fileName }) => fileName === name);
		const commandsOf = (
			plan: { commands: readonly { command: string }[] } | undefined
		) => plan?.commands.map(({ command }) => command);

		it("should write the config that converts path requires, where there is none", async () => {
			const plan = await planWithDarklua();

			expect(JSON.parse(fileOf(plan, ".darklua.json")!.content)).toEqual({
				rules: [
					{
						rule: "convert_require",
						current: { name: "path" },
						target: {
							name: "roblox",
							rojo_sourcemap: "./sourcemap.json",
							indexing_style: "property",
						},
					},
				],
			});
		});

		it("should write a config with no rules for compiled code, which has no path requires", async () => {
			await write("tsconfig.json", "{}");

			const plan = await planWithDarklua();

			expect(JSON.parse(fileOf(plan, ".darklua.json")!.content)).toEqual({
				rules: [],
			});
		});

		it("should leave a config that is there as it is", async () => {
			await write(".darklua.json5", "{}");

			const plan = await planWithDarklua();

			expect(names(plan)).not.toContain(".darklua.json");
		});

		it("should have the new .gitignore list the sync path", async () => {
			const plan = await planWithDarklua();

			expect(fileOf(plan, ".gitignore")?.content).toContain("\n/dist\n");
			expect(plan?.nextSteps.edits.join("\n")).not.toContain(
				"to .gitignore"
			);
		});

		it("should not edit a .gitignore that is there, and say what to add", async () => {
			await write(".gitignore", "sourcemap.json\n");

			const plan = await planWithDarklua();

			expect(names(plan)).not.toContain(".gitignore");
			expect(plan?.nextSteps.edits).toContain(
				"Add /dist to .gitignore so the processed code isn't committed."
			);
		});

		it("should say nothing when the .gitignore there lists the sync path", async () => {
			await write(".gitignore", "dist/\n");

			const plan = await planWithDarklua();

			expect(plan?.nextSteps.edits.join("\n")).not.toContain(
				"to .gitignore"
			);
		});

		it("should leave the sourcemap to luau-lsp where the editor settings name it", async () => {
			await write(
				".vscode/settings.json",
				'{ "luau-lsp.sourcemap.enabled": true }'
			);

			const plan = await planWithDarklua();

			expect(plan?.nextSteps.edits.join("\n")).not.toContain("sourcemap");
		});

		it("should pin it beside Rojo, and install both with the manager", async () => {
			processes.installed.delete("rojo");
			processes.installed.set("rokit", "/bin/rokit");

			const plan = await planWithDarklua();

			expect(fileOf(plan, "rokit.toml")?.content).toBe("[tools]\n");
			expect(commandsOf(plan)).toEqual([
				"rokit add rojo-rbx/rojo@7.7.1",
				`rokit add ${DARKLUA_PIN}`,
			]);
		});

		it("should pin only Darklua when Rojo runs", async () => {
			processes.installed.set("rokit", "/bin/rokit");

			const plan = await planWithDarklua();

			expect(commandsOf(plan)).toEqual([`rokit add ${DARKLUA_PIN}`]);
		});

		it("should pin nothing when Darklua runs or a toolchain file pins it", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			processes.installed.set("darklua", "/bin/darklua");
			processes.outputs.set("/bin/darklua", {
				code: 0,
				stdout: "darklua 0.19.0\n",
				stderr: "",
			});
			const running = await planWithDarklua();
			processes.installed.delete("darklua");
			await write("rokit.toml", `[tools]\ndarklua = "${DARKLUA_PIN}"\n`);
			const pinned = await planWithDarklua();

			expect(running?.commands).toEqual([]);
			expect(pinned?.commands).toEqual([]);
		});

		it("should pin nothing when the project does not use Darklua", async () => {
			processes.installed.set("rokit", "/bin/rokit");

			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.commands).toEqual([]);
		});

		it("should write Foreman's lines for both, then install", async () => {
			processes.installed.delete("rojo");
			processes.installed.set("foreman", "/bin/foreman");

			const plan = await planWithDarklua();

			expect(fileOf(plan, "foreman.toml")?.content).toBe(
				'[tools]\nrojo = { github = "rojo-rbx/rojo", version = "7.7.1" }\ndarklua = { github = "seaofvoices/darklua", version = "0.19.0" }\n'
			);
			expect(commandsOf(plan)).toEqual(["foreman install"]);
		});
	});

	describe("Rojo", () => {
		const PIN = "rojo-rbx/rojo@7.7.1";
		const pinQuestion = (manager: string) =>
			`Pin Rojo 7.7.1 with ${manager}?`;
		const INSTALL_QUESTION =
			"Rojo isn't installed, and rogen serve needs it. Install Rokit and Rojo now?";
		const PLUGIN_QUESTION = "Install Rojo's Studio plugin?";
		const names = (plan: { files: readonly PlannedFile[] } | undefined) =>
			plan?.files.map(({ fileName }) => fileName);
		const fileOf = (
			plan: { files: readonly PlannedFile[] } | undefined,
			name: string
		) => plan?.files.find(({ fileName }) => fileName === name);
		const commandsOf = (
			plan: { commands: readonly { command: string }[] } | undefined
		) => plan?.commands.map(({ command }) => command);

		beforeEach(() => {
			processes.installed.delete("rojo");
		});

		it("should do nothing when Rojo runs", async () => {
			processes.installed.set("rojo", "/bin/rojo");
			processes.outputs.set("/bin/rojo", ROJO_VERSION);
			processes.installed.set("rokit", "/bin/rokit");
			const prompts = new MockPromptService({});

			const plan = (await serviceFor(prompts).plan()).unwrap();

			expect(prompts.asked).not.toContain(pinQuestion("rokit"));
			expect(plan?.commands).toEqual([]);
			expect(names(plan)).not.toContain("rokit.toml");
		});

		it("should pin it with the manager found, writing the file it needs", async () => {
			processes.installed.set("rokit", "/bin/rokit");

			const plan = (await serviceFor().plan()).unwrap();

			expect(fileOf(plan, "rokit.toml")).toEqual({
				fileName: "rokit.toml",
				content: "[tools]\n",
			});
			expect(commandsOf(plan)).toEqual([`rokit add ${PIN}`]);
			expect(plan?.commands[0]).toMatchObject({
				file: "rokit",
				args: ["add", PIN],
			});
			expect(plan?.decided).toContainEqual({
				question: "rojo",
				value: true,
				flag: "--rojo",
			});
		});

		it("should add to the Rokit file that is there, which it leaves as it is", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			await write(
				"rokit.toml",
				'[tools]\nwally = "UpliftGames/wally@0.3.2"\n'
			);
			const prompts = new MockPromptService({});

			const plan = (await serviceFor(prompts).plan()).unwrap();

			expect(prompts.asked).toContain(pinQuestion("rokit"));
			expect(names(plan)).not.toContain("rokit.toml");
			expect(commandsOf(plan)).toEqual([
				`rokit add ${PIN}`,
				"rojo plugin install",
			]);
		});

		it("should use Aftman for an aftman.toml here, and for Aftman alone", async () => {
			processes.installed.set("aftman", "/bin/aftman");

			const plan = (await serviceFor().plan()).unwrap();

			expect(fileOf(plan, "aftman.toml")?.content).toBe("[tools]\n");
			expect(commandsOf(plan)).toEqual([`aftman add ${PIN}`]);
		});

		it("should write Foreman's line itself and have it install", async () => {
			processes.installed.set("foreman", "/bin/foreman");
			await write("foreman.toml", "[tools]\n");

			const plan = (await serviceFor().plan()).unwrap();

			expect(fileOf(plan, "foreman.toml")).toEqual({
				fileName: "foreman.toml",
				content:
					'[tools]\nrojo = { github = "rojo-rbx/rojo", version = "7.7.1" }\n',
				addition: "Rojo's pin",
			});
			expect(commandsOf(plan)).toEqual(["foreman install"]);
		});

		it("should run nothing when the pin is declined, and say how to set it up", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			const declined = new MockPromptService({
				[pinQuestion("rokit")]: false,
			});

			const plan = (await serviceFor(declined).plan()).unwrap();

			expect(plan?.commands).toEqual([]);
			expect(names(plan)).not.toContain("rokit.toml");
			expect(plan?.nextSteps.setup).toEqual([
				"Rojo isn't pinned, and rogen serve needs it. Run 'rogen init --rojo' to pin it with rokit.",
			]);
		});

		it("should install nothing when there is no manager and it can't ask", async () => {
			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.commands).toEqual([]);
			expect(plan?.decided).toContainEqual({
				question: "rojo",
				value: "not installed",
				flag: "--rojo",
			});
			expect(plan?.nextSteps.setup[0]).toMatch(
				/^Rojo isn't installed, and rogen serve needs it\. Run 'rogen init --rojo' to install Rokit and Rojo, or install Rokit yourself \(.+\)/
			);
		});

		it("should install Rokit and then pin Rojo with it, when told to", async () => {
			const plan = (
				await serviceFor().plan({ ask: false, choices: { rojo: true } })
			).unwrap();

			expect(plan?.commands.map(({ file }) => file)).toEqual([
				expect.stringMatching(/^(sh|powershell)$/),
				"rokit",
			]);
			expect(plan?.commands[0].command).toContain(
				"rojo-rbx/rokit/main/scripts/install"
			);
			expect(commandsOf(plan)?.[1]).toBe(`rokit add ${PIN}`);
			expect(fileOf(plan, "rokit.toml")?.content).toBe("[tools]\n");
		});

		it("should ask before installing Rokit, and show what it runs", async () => {
			const prompts = new MockPromptService({ [INSTALL_QUESTION]: true });

			const plan = (await serviceFor(prompts).plan()).unwrap();

			expect(prompts.asked).toContain(INSTALL_QUESTION);
			expect(plan?.commands).toHaveLength(3);
			expect(plan?.commands.at(-1)).toMatchObject({
				file: "rojo",
				args: ["plugin", "install"],
			});
		});

		it("should install nothing when the install is declined", async () => {
			const declined = new MockPromptService({
				[INSTALL_QUESTION]: false,
			});

			const plan = (await serviceFor(declined).plan()).unwrap();

			expect(plan?.commands).toEqual([]);
			expect(declined.asked).not.toContain(PLUGIN_QUESTION);
		});

		it("should install the plugin after the pin when asked, else name the command", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			const yes = (
				await serviceFor(new MockPromptService({})).plan()
			).unwrap();
			const no = (
				await serviceFor(
					new MockPromptService({ [PLUGIN_QUESTION]: false })
				).plan()
			).unwrap();

			expect(commandsOf(yes)).toEqual([
				`rokit add ${PIN}`,
				"rojo plugin install",
			]);
			expect(commandsOf(no)).toEqual([`rokit add ${PIN}`]);
			expect(no?.nextSteps.setup).toEqual([
				"Run 'rogen plugin install' to install Rojo's Studio plugin.",
			]);
		});

		it("should leave the plugin to the user in a run that can't ask, and say it took that", async () => {
			processes.installed.set("rokit", "/bin/rokit");

			const plan = (await serviceFor().plan()).unwrap();

			expect(commandsOf(plan)).toEqual([`rokit add ${PIN}`]);
			expect(plan?.decided).toContainEqual({
				question: "plugin",
				value: false,
				flag: "--studio-plugin",
			});
		});

		it("should not offer it once Rojo is pinned, here or above", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			await write("rokit.toml", "[tools]\n");
			await fileSystem.writeFile(
				path.resolve("/mock/aftman.toml"),
				`[tools]\nrojo = "${PIN}"\n`
			);
			const prompts = new MockPromptService({});

			await serviceFor(prompts).plan();

			expect(prompts.asked).not.toContain(pinQuestion("rokit"));
		});

		it("should not offer it when the file uses the name rojo for another tool", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			await write("rokit.toml", '[tools]\nrojo = "someone/fork@1.0.0"\n');
			const prompts = new MockPromptService({});

			await serviceFor(prompts).plan();

			expect(prompts.asked).not.toContain(pinQuestion("rokit"));
		});

		it("should offer it beside a config, and add only it", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			await write("rogen.json", "{}");
			await write("AGENTS.md", agentBlock);
			const prompts = new MockPromptService({
				[WHAT_TO_ADD]: "rojo",
			});

			const plan = (await serviceFor(prompts).plan()).unwrap();

			expect(names(plan)).toEqual(["rokit.toml"]);
			expect(commandsOf(plan)).toEqual([
				`rokit add ${PIN}`,
				"rojo plugin install",
			]);
		});

		it("should install the plugin on its own beside a config, when told to", async () => {
			processes.installed.set("rojo", "/bin/rojo");
			processes.outputs.set("/bin/rojo", ROJO_VERSION);
			await write("rogen.json", "{}");

			const plan = (
				await serviceFor().plan({
					ask: false,
					choices: { plugin: true },
				})
			).unwrap();

			expect(commandsOf(plan)).toEqual(["rojo plugin install"]);
		});
	});

	describe("a project of a kind", () => {
		const files = (plan: InitPlan | undefined) =>
			Object.fromEntries(
				(plan?.files ?? []).map(({ fileName, content }) => [
					fileName,
					content,
				])
			);

		it("should start a model with Rojo's template and no routes", async () => {
			const plan = (
				await serviceFor().plan({ choices: { kind: "model" } })
			).unwrap();

			expect(Object.keys(files(plan))).toEqual([
				"rogen.json",
				"README.md",
				".gitignore",
				"src/init.luau",
				"AGENTS.md",
			]);
			expect(JSON.parse(files(plan)["rogen.json"])).toEqual({
				$schema: expect.any(String),
				tree: { $path: "src" },
			});
			expect(plan?.nextSteps.run).toEqual([
				'rogen build -o "my-game.rbxmx"',
			]);
			expect(plan?.decided.map(({ flag }) => flag)).not.toContain(
				"--source-path"
			);
		});

		it("should start a plugin with a script that runs", async () => {
			const plan = (
				await serviceFor().plan({ choices: { kind: "plugin" } })
			).unwrap();

			expect(Object.keys(files(plan))).toContain("src/init.server.luau");
			expect(plan?.nextSteps.run).toEqual([
				'rogen build -p "my-game.rbxm"',
			]);
		});

		it("should leave a file of the template alone where one exists", async () => {
			await write("README.md", "mine");
			await write("src/init.luau", "return 1");

			const plan = (
				await serviceFor().plan({ choices: { kind: "model" } })
			).unwrap();

			expect(Object.keys(files(plan))).not.toContain("README.md");
			expect(Object.keys(files(plan))).not.toContain("src/init.luau");
		});

		it("should write no .gitignore, and ask for no git, with skipGit", async () => {
			const plan = (
				await serviceFor().plan({ choices: { skipGit: true } })
			).unwrap();

			expect(Object.keys(files(plan))).not.toContain(".gitignore");
			expect(plan?.gitInit).toBe(false);
		});

		it("should ask for git init where git is installed and no work tree holds the folder", async () => {
			processes.installed.set("git", "/bin/git");

			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.gitInit).toBe(true);
		});

		it("should run git init when it writes, and only say so in a dry run", async () => {
			processes.installed.set("git", "/bin/git");
			processes.outputs.set("/bin/git", {
				code: 0,
				stdout: "",
				stderr: "",
			});
			const service = serviceFor();
			const plan = (await service.plan()).unwrap()!;
			const written: InitWritten[] = [];
			processes.execs.length = 0;

			await service.write(plan, (item) => written.push(item), true);
			expect(processes.execs).toEqual([]);
			await service.write(plan, (item) => written.push(item));

			expect(processes.execs.map(({ args }) => args)).toEqual([["init"]]);
			expect(written.filter(({ kind }) => kind === "git")).toHaveLength(
				2
			);
		});

		it("should say a git init that fails, and write the project all the same", async () => {
			processes.installed.set("git", "/bin/git");
			processes.outputs.set("/bin/git", {
				code: 128,
				stdout: "",
				stderr: "fatal: no\n",
			});
			const service = serviceFor();
			const plan = (await service.plan()).unwrap()!;
			const written: InitWritten[] = [];

			const result = await service.write(plan, (item) =>
				written.push(item)
			);

			expect(result.isOk()).toBe(true);
			expect(written).toContainEqual({
				kind: "git",
				failed: "fatal: no",
			});
		});

		it("should not ask for git init inside a work tree, here or above", async () => {
			processes.installed.set("git", "/bin/git");
			await fileSystem.createDirectory(path.resolve("/mock/.git"));

			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.gitInit).toBe(false);
			expect(plan?.files.map(({ fileName }) => fileName)).toContain(
				".gitignore"
			);
		});

		it("should not ask for git init without git", async () => {
			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.gitInit).toBe(false);
		});

		it("should ask for no source path when a lifted project takes no routes, and name none in the steps", async () => {
			await write("tsconfig.json", "{}");
			await write(
				"default.project.json",
				JSON.stringify({ name: "lib", tree: { $path: "src" } })
			);

			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.decided.map(({ flag }) => flag)).not.toContain(
				"--source-path"
			);
			expect(JSON.stringify(plan?.nextSteps)).not.toContain("undefined");
			expect(plan?.directories).toEqual([]);
		});

		it("should write the kind and the git step it took down when it can't ask", async () => {
			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.decided).toEqual(
				expect.arrayContaining([
					{ question: "kind", value: "place", flag: "--kind" },
					{ question: "skipGit", value: false, flag: "--skip-git" },
				])
			);
		});

		it("should refuse the flags of a new project beside a config", async () => {
			await write("rogen.json", "{}");

			const result = await serviceFor().plan({
				choices: { kind: "model" },
			});

			expect((result as ResultError<Error>).error.message).toContain(
				"--kind"
			);
		});
	});

	describe("a folder named on the command line", () => {
		it("should start a project there when no config is at or above it, and make the folder", async () => {
			const plan = (
				await serviceFor().plan({ place: "newproj" })
			).unwrap();

			expect(plan?.directory).toBe(path.join(directory, "newproj"));
			expect(plan?.configs).toEqual(["newproj/rogen.json"]);
			expect(plan?.notes[0]).toContain("starts a project there");
			expect(
				await fileSystem.exists(path.join(directory, "newproj"))
			).toBe(false);
		});

		it("should name the folder after the project it starts", async () => {
			const plan = (
				await serviceFor().plan({
					place: "newproj",
					choices: { kind: "model" },
				})
			).unwrap();

			expect(plan?.nextSteps.run).toEqual([
				'rogen build -o "newproj.rbxmx"',
			]);
		});

		it("should add a place when a config is above it", async () => {
			await write("rogen.json", "{}");

			const plan = (
				await serviceFor().plan({ place: "places/lobby" })
			).unwrap();

			expect(plan?.directory).toBe(directory);
			expect(plan?.files[0].fileName).toBe("rogen.json");
		});

		it("should refuse the flags of a place for a project it starts", async () => {
			const result = await serviceFor().plan({
				place: "newproj",
				choices: { placeIds: ["1"] },
			});

			expect((result as ResultError<Error>).error.message).toContain(
				"--place-id"
			);
		});
	});

	describe("plan", () => {
		it("should take every default when it can't ask", async () => {
			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.files.map(({ fileName }) => fileName)).toEqual([
				"rogen.json",
				".gitignore",
				"src/Greeter/Shared/Greeting.luau",
				"src/Greeter/Server/Greeter.server.luau",
				"src/Greeter/Client/Greeter.client.luau",
				"README.md",
				"AGENTS.md",
			]);
			expect(plan?.configs).toEqual(["rogen.json"]);
			expect(plan?.nextSteps.run).toEqual(["rogen serve"]);
		});

		it("should resolve to nothing when the user cancels", async () => {
			const result = await serviceFor(
				new MockPromptService([CANCEL])
			).plan();

			expect(result.unwrap()).toBeUndefined();
		});

		it("should lift a hand-written project file into rogen.json", async () => {
			await write(
				"default.project.json",
				JSON.stringify({
					name: "mine",
					tree: { $className: "DataModel", Workspace: {} },
				})
			);

			const plan = (await serviceFor().plan()).unwrap();

			expect(JSON.parse(plan?.files[0].content ?? "{}")).toMatchObject({
				name: "mine",
				tree: { $className: "DataModel", Workspace: {} },
			});
			expect(plan?.notes).toEqual([
				"Lifting default.project.json into rogen.json, since Rogen replaces default.project.json on every build.",
			]);
		});

		it("should fail when the hand-written project file is not a project file", async () => {
			await write("default.project.json", "[]");

			const result = await serviceFor().plan();

			expect(
				result.isErr() &&
					result.error instanceof DiagnosticsError &&
					result.error.diagnostics
			).toMatchObject([{ code: "init.projectUnreadable" }]);
		});

		describe("beside an existing rogen.json", () => {
			const planWith = async (answers: PromptScript) => {
				await write("rogen.json", "{}");
				const prompts = new MockPromptService(answers);
				const result = await serviceFor(prompts).plan();
				return { prompts, result };
			};

			it("should ask what to add, preselecting agent instructions and asking nothing more", async () => {
				const { prompts, result } = await planWith({
					[WHAT_TO_ADD]: ACCEPT_DEFAULT,
				});

				expect(prompts.asked).toEqual([WHAT_TO_ADD]);
				expect(
					result.unwrap()?.files.map(({ fileName }) => fileName)
				).toEqual(["AGENTS.md"]);
			});

			it("should plan nothing when the user cancels what to add", async () => {
				const { prompts, result } = await planWith([CANCEL]);

				expect(prompts.asked).toEqual([WHAT_TO_ADD]);
				expect(result.unwrap()).toBeUndefined();
			});

			it("should fail naming the config when there is nothing left to add or to report", async () => {
				await write("rogen.json", "{}");

				const result = await serviceFor(new MockPromptService([])).plan(
					{
						choices: { agentRules: false },
					}
				);

				expect(
					result.isErr() &&
						result.error instanceof DiagnosticsError &&
						result.error.diagnostics
				).toMatchObject([
					{
						code: "init.configExists",
						resource: path.join(directory, "rogen.json"),
						message:
							"this config already exists, and init never overwrites one. To add Rogen's agent rules, the agent hook or the Rojo pin to it, run init with --agent-rules, --agent-hook or --rojo-pin.",
					},
				]);
			});
		});
	});

	describe("write", () => {
		const planned = async (): Promise<InitPlan> =>
			(
				await serviceFor().plan({ choices: { sample: false } })
			).unwrap() as InitPlan;

		it("should write the config and the agent file into the directory", async () => {
			await write("tsconfig.json", "{}");
			const plan = await planned();
			const names = plan.files.map(({ fileName }) => fileName);

			const result = await serviceFor().write(plan, () => undefined);

			expect(result.isOk()).toBe(true);
			expect(names).toContain("rogen.json");
			for (const name of names) {
				expect(
					await fileSystem.exists(path.join(directory, name))
				).toBe(true);
			}
		});

		it("should report each file as it is written", async () => {
			const onWritten = jest.fn<(written: InitWritten) => void>();

			await serviceFor().write(await planned(), onWritten);

			expect(onWritten).toHaveBeenCalledWith({
				kind: "file",
				file: expect.objectContaining({
					fileName: "rogen.json",
				}),
			});
		});

		it("should stop at the file it can't write and name it", async () => {
			const onWritten = jest.fn<(written: InitWritten) => void>();
			jest.spyOn(fileSystem, "writeFile").mockRejectedValue(
				new Error("disk full")
			);

			const result = await serviceFor().write(await planned(), onWritten);

			expect((result as ResultError<Error>).error.message).toBe(
				"Failed to write rogen.json: disk full"
			);
			expect(onWritten).not.toHaveBeenCalled();
		});

		it("should create a directory that doesn't exist after the files, and report it", async () => {
			const onWritten = jest.fn<(written: InitWritten) => void>();
			const plan = {
				...(await planned()),
				directories: ["lib"],
			};

			const result = await serviceFor().write(plan, onWritten);

			expect(result.isOk()).toBe(true);
			expect(await fileSystem.exists(path.join(directory, "lib"))).toBe(
				true
			);
			const last = onWritten.mock.calls[onWritten.mock.calls.length - 1];
			expect(last[0]).toEqual({
				kind: "directory",
				directory: "lib",
			});
		});

		it("should leave a directory that exists alone and not report it", async () => {
			await write("src/Keep.luau", "");
			const onWritten = jest.fn<(written: InitWritten) => void>();
			const plan = { ...(await planned()), directories: ["src"] };

			await serviceFor().write(plan, onWritten);

			expect(
				onWritten.mock.calls.filter(
					([written]) => written.kind === "directory"
				)
			).toEqual([]);
			expect(
				await fileSystem.exists(path.join(directory, "src/Keep.luau"))
			).toBe(true);
		});

		it("should name the directory it can't create", async () => {
			jest.spyOn(fileSystem, "createDirectory").mockRejectedValue(
				new Error("read-only")
			);
			const plan = {
				...(await planned()),
				directories: ["lib"],
			};

			const result = await serviceFor().write(plan, () => undefined);

			expect((result as ResultError<Error>).error.message).toBe(
				"Failed to create lib: read-only"
			);
		});
	});
});
