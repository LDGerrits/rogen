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
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import {
	ConfirmPromptOptions,
	MultiSelectPromptOptions,
	PromptService,
	SelectPromptOptions,
	TextPromptOptions,
} from "../../../platform/prompt/prompt-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { CoreInitService } from "../core-init-service.js";
import { InitPlan, InitWritten } from "../init-service.js";

const directory = path.resolve("/mock/my-game");

const ROJO_VERSION = { code: 0, stdout: "Rojo 7.7.1\n", stderr: "" };

const SUMMARY_QUESTIONS = ["Create this project?"];

class CustomiseFirst implements PromptService {
	declare readonly _serviceBrand: undefined;
	readonly isInteractive = true;
	private readonly answers = new Map<string, unknown>();
	private summaries = 0;

	constructor(private readonly inner: PromptService) {}

	private async once<T>(
		message: string,
		ask: () => Promise<T | undefined>
	): Promise<T | undefined> {
		if (this.answers.has(message)) return this.answers.get(message) as T;
		const answer = await ask();
		this.answers.set(message, answer);
		return answer;
	}

	async select<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined> {
		if (SUMMARY_QUESTIONS.includes(options.message))
			return (this.summaries++ === 0 ? "customise" : "yes") as T;
		return this.once(options.message, () => this.inner.select(options));
	}

	autocomplete<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined> {
		return this.once(options.message, () =>
			this.inner.autocomplete(options)
		);
	}

	text(options: TextPromptOptions): Promise<string | undefined> {
		return this.once(options.message, () => this.inner.text(options));
	}

	confirm(options: ConfirmPromptOptions): Promise<boolean | undefined> {
		return this.once(options.message, () => this.inner.confirm(options));
	}

	multiSelect<T extends string>(
		options: MultiSelectPromptOptions<T>
	): Promise<readonly T[] | undefined> {
		return this.once(options.message, () =>
			this.inner.multiSelect(options)
		);
	}
}

const askingEach = (prompts: PromptService): PromptService =>
	new CustomiseFirst(prompts);

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
		const service = new CoreInitService(
			fileSystem,
			promptService,
			environmentService,
			new CoreToolchainService(fileSystem),
			processes
		);
		return service;
	};

	const write = (file: string, content = "") =>
		fileSystem.writeFile(path.join(directory, file), content);

	describe("plan, before it asks", () => {
		it("should read the directory's toolchain", async () => {
			await write("tsconfig.json", "{}");

			const plan = (await serviceFor().plan()).unwrap();

			const config = plan?.files.find(
				({ fileName }) => fileName === "default.rogen.json"
			);
			expect(
				JSON.parse(config?.content ?? "{}").rogen?.routes
			).toHaveProperty("server");
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

	describe("in a folder that has a config", () => {
		const refused = async (
			promptService: PromptService,
			options: Parameters<CoreInitService["plan"]>[0] = {}
		) => {
			const result = await serviceFor(promptService).plan(options);
			return (
				result.isErr() &&
				result.error instanceof DiagnosticsError &&
				result.error.diagnostics
			);
		};

		it.each(["default.rogen.json", "default.rogen.jsonc"])(
			"should fail with init.configExists for %s, naming where to look",
			async (name) => {
				await write(name, "{}");

				expect(
					await refused(new MockPromptService([]), { ask: false })
				).toMatchObject([
					{
						code: "init.configExists",
						resource: path.join(directory, name),
						message: expect.stringContaining(
							"https://rogen-playfully.vercel.app/docs/v2/agents"
						),
					},
				]);
			}
		);

		it("should ask nothing and plan nothing, whatever the flags ask for", async () => {
			await write("default.rogen.json", "{}");
			const prompts = new MockPromptService([]);

			const diagnostics = await refused(prompts, {
				choices: { agentRules: true, agentHook: true, rojo: true },
			});

			expect(diagnostics).toMatchObject([{ code: "init.configExists" }]);
			expect(prompts.asked).toEqual([]);
		});

		it("should fail for a named folder that has one", async () => {
			await fileSystem.createDirectory(path.join(directory, "lobby"));
			await write("lobby/default.rogen.json", "{}");

			expect(
				await refused(new MockPromptService([]), { place: "lobby" })
			).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(
						directory,
						"lobby",
						"default.rogen.json"
					),
				},
			]);
		});

		it("should start a project in a folder below a config, asking nothing about it", async () => {
			const below = path.join(directory, "src", "Inventory");
			await fileSystem.createDirectory(below);
			await write("default.rogen.json", "{}");
			const prompts = new MockPromptService([]);

			const result = await serviceFor(prompts, below).plan({
				ask: false,
			});

			expect(prompts.asked).toEqual([]);
			expect(
				result.unwrap()?.files.map(({ fileName }) => fileName)
			).toContain("default.rogen.json");
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
				await serviceFor(askingEach(prompts)).plan({
					choices: { sample: false },
				})
			).unwrap();
		const fileOf = (
			plan: { files: readonly PlannedFile[] } | undefined,
			name: string
		) => plan?.files.find(({ fileName }) => fileName === name);

		it("should offer it where an agent is in use, and write the script and the agent's file", async () => {
			await write(".claude/keep", "");

			const plan = await planned();

			expect(names(plan)).toEqual([
				"default.rogen.json",
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
				"default.rogen.json",
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
				"default.rogen.json",
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
				"default.rogen.json",
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
				"default.rogen.json",
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

		it("should have the new .gitignore list the compiled path", async () => {
			const plan = await planWithDarklua();

			expect(fileOf(plan, ".gitignore")?.content).toContain("\n/dist\n");
			expect(plan?.nextSteps.edits.join("\n")).not.toContain(
				"/dist to .gitignore"
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

		it("should say nothing when the .gitignore there lists the compiled path", async () => {
			await write(".gitignore", "dist/\n");

			const plan = await planWithDarklua();

			expect(plan?.nextSteps.edits.join("\n")).not.toContain(
				"/dist to .gitignore"
			);
		});

		it("should know the other ways a .gitignore lists the compiled path", async () => {
			for (const line of [
				"dist/*",
				"/dist/",
				"**/dist",
				"/dist # built",
			]) {
				await write(".gitignore", `${line.replace(" # built", "")}\n`);

				const plan = await planWithDarklua();

				expect(plan?.nextSteps.edits.join("\n")).not.toContain(
					"/dist to .gitignore"
				);
			}
		});

		it("should keep the sourcemap step when luau-lsp is told not to make it", async () => {
			await write(
				".vscode/settings.json",
				'{ "luau-lsp.sourcemap.autogenerate": false }'
			);

			const plan = await planWithDarklua();

			expect(plan?.nextSteps.edits.join("\n")).toContain("sourcemap");
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

			const plan = (
				await serviceFor(askingEach(prompts)).plan()
			).unwrap();

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

			const plan = (
				await serviceFor(askingEach(declined)).plan()
			).unwrap();

			expect(plan?.commands).toEqual([]);
			expect(names(plan)).not.toContain("rokit.toml");
			expect(plan?.nextSteps.setup).toEqual([
				"Rojo isn't pinned, and rogen serve needs it. To pin it with rokit, run 'rokit add rojo-rbx/rojo@7.7.1'.",
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
				/^Rojo isn't installed, and rogen serve needs it\. Install Rokit \(.+\), then run 'rokit init' and 'rokit add rojo-rbx\/rojo@7\.7\.1' here\./
			);
		});

		it("should install Rokit and then pin Rojo with it, when told to", async () => {
			const plan = (
				await serviceFor().plan({ ask: false, choices: { rojo: true } })
			).unwrap();

			expect(plan?.commands.map(({ file }) => file)).toEqual([
				expect.stringMatching(/^(bash|powershell)$/),
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

			const plan = (
				await serviceFor(askingEach(prompts)).plan()
			).unwrap();

			expect(prompts.asked).toContain(INSTALL_QUESTION);
			expect(plan?.commands).toHaveLength(3);
			expect(plan?.commands.at(-1)).toMatchObject({
				file: "rojo",
				args: ["plugin", "install"],
			});
		});

		it("should install the Rokit installer so that a failed download fails the step", async () => {
			const plan = (
				await serviceFor().plan({ ask: false, choices: { rojo: true } })
			).unwrap();

			const [installer] = plan?.commands ?? [];
			expect(installer.args.at(-1)).toMatch(
				/^(set -o pipefail; curl |Invoke-RestMethod )/
			);
		});

		it("should pin nothing when the folder's manager is not installed", async () => {
			await write("aftman.toml", "[tools]\n");
			const prompts = new MockPromptService({});

			const plan = (await serviceFor(prompts).plan()).unwrap();

			expect(plan?.commands).toEqual([]);
			expect(names(plan)).not.toContain("rokit.toml");
			expect(plan?.nextSteps.setup).toEqual([
				"Rojo isn't pinned in aftman.toml, and aftman isn't installed. Install it, then run 'aftman add rojo-rbx/rojo@7.7.1'.",
			]);
		});

		it("should install nothing when the install is declined", async () => {
			const declined = new MockPromptService({
				[INSTALL_QUESTION]: false,
			});

			const plan = (
				await serviceFor(askingEach(declined)).plan()
			).unwrap();

			expect(plan?.commands).toEqual([]);
			expect(declined.asked).not.toContain(PLUGIN_QUESTION);
		});

		it("should install the plugin after the pin when asked, else name the command", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			const yes = (
				await serviceFor(askingEach(new MockPromptService({}))).plan()
			).unwrap();
			const no = (
				await serviceFor(
					askingEach(
						new MockPromptService({ [PLUGIN_QUESTION]: false })
					)
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
				"default.rogen.json",
				"README.md",
				".gitignore",
				"src/init.luau",
				"AGENTS.md",
			]);
			expect(JSON.parse(files(plan)["default.rogen.json"])).toEqual({
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
	});

	describe("a folder named on the command line", () => {
		it("should start a project there, and make the folder", async () => {
			const plan = (
				await serviceFor().plan({ place: "newproj" })
			).unwrap();

			expect(plan?.directory).toBe(path.join(directory, "newproj"));
			expect(plan?.configs).toEqual(["newproj/default.rogen.json"]);
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
	});

	describe("plan", () => {
		it("should take every default when it can't ask", async () => {
			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.files.map(({ fileName }) => fileName)).toEqual([
				"default.rogen.json",
				".gitignore",
				"src/Greeter/Shared/Greeting.luau",
				"src/Greeter/Server/Greeter.server.luau",
				"src/Greeter/Client/Greeter.client.luau",
				"README.md",
				"AGENTS.md",
			]);
			expect(plan?.configs).toEqual(["default.rogen.json"]);
			expect(plan?.nextSteps.run).toEqual(["rogen serve"]);
		});

		it("should resolve to nothing when the user cancels", async () => {
			const result = await serviceFor(
				new MockPromptService([CANCEL])
			).plan();

			expect(result.unwrap()).toBeUndefined();
		});

		it("should lift a hand-written project file into default.rogen.json", async () => {
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
				"Lifting default.project.json into default.rogen.json, since Rogen replaces default.project.json on every build.",
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
	});

	describe("the summary of a new project", () => {
		const CREATE = "Create this project?";
		const review = (prompts: PromptService) => serviceFor(prompts).plan();

		it("should ask the language and the layout of an empty folder, then show the summary only", async () => {
			const prompts = new MockPromptService({
				Language: "luau",
				"One place or several?": "one",
				[CREATE]: "yes",
			});

			const plan = (await review(prompts)).unwrap();

			expect(prompts.asked).toEqual([
				"Language",
				"One place or several?",
				CREATE,
			]);
			expect(plan?.files.map(({ fileName }) => fileName)).toContain(
				"default.rogen.json"
			);
			expect(plan?.decided).toEqual([]);
		});

		it("should not ask the language of a folder that has a tsconfig.json", async () => {
			await write("tsconfig.json", "{}");
			const prompts = new MockPromptService({ [CREATE]: "yes" });

			await review(prompts);

			expect(prompts.asked).toEqual([CREATE]);
		});

		it("should show the choices and every file the plan writes", async () => {
			const prompts = new MockPromptService({
				Language: "luau",
				[CREATE]: "yes",
			});

			await review(prompts);
			const shown = prompts.prompts.at(-1)?.description ?? "";

			expect(shown).toContain(
				"Project   one place, Luau, sample Greeter"
			);
			expect(shown).toContain("Darklua   no");
			expect(shown).toContain("Agents    rules in AGENTS.md");
			expect(shown).toContain("default.rogen.json");
		});

		it("should plan nothing on Cancel", async () => {
			const prompts = new MockPromptService({
				Language: "luau",
				"One place or several?": "one",
				[CREATE]: "cancel",
			});

			expect((await review(prompts)).unwrap()).toBeUndefined();
		});

		it("should ask every question on Customise, then show the summary with the new answer", async () => {
			const prompts = new MockPromptService([
				"luau",
				"one",
				"customise",
				"luau",
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				"lib",
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				"yes",
			]);

			const plan = (await review(prompts)).unwrap();

			expect(prompts.asked).toEqual([
				"Language",
				"One place or several?",
				CREATE,
				"Language",
				"Does Darklua process your code before Rojo syncs it?",
				"One place or several?",
				"Source paths",
				"Routes",
				"Files that match no route",
				"Add Rogen's rules for coding agents to AGENTS.md?",
				CREATE,
			]);
			expect(prompts.prompts.at(-1)?.description).toContain(
				"lib → Server"
			);
			expect(plan?.summary).toContainEqual({
				area: "Code",
				text: expect.stringContaining("lib"),
			});
		});

		it("should list every file and command of the plan, as a dry run would write them", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			processes.installed.delete("rojo");
			const prompts = new MockPromptService({
				Language: "luau",
				[CREATE]: "yes",
			});
			const service = serviceFor(prompts);

			const plan = (await service.plan()).unwrap()!;
			const written: string[] = [];
			await service.write(
				plan,
				(item) => {
					if (item.kind === "file") written.push(item.file.fileName);
					if (item.kind === "command")
						written.push(item.command.command);
				},
				true
			);
			const shown = prompts.prompts
				.at(-1)
				?.description?.replace(/\n\s{10}/g, " ");

			expect(written.length).toBeGreaterThan(5);
			for (const item of written) expect(shown).toContain(item);
			expect(plan.commands.length).toBeGreaterThan(0);
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
			expect(names).toContain("default.rogen.json");
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
					fileName: "default.rogen.json",
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
				"Failed to write default.rogen.json: disk full"
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
