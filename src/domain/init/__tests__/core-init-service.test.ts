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
import { CoreConfigService } from "../../config/core-config-service.js";
import { CoreInitService } from "../core-init-service.js";
import { InitPlan, InitWritten } from "../init-service.js";

const WHAT_TO_ADD = "rogen.json exists. What do you want to add?";
const directory = path.resolve("/mock/my-game");

describe("CoreInitService", () => {
	let fileSystem: MemoryFileSystemService;

	beforeEach(async () => {
		fileSystem = new MemoryFileSystemService();
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
			new CoreConfigService(fileSystem, environmentService)
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
			const plan = (await serviceFor(prompts).plan()).unwrap();
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

			const result = await serviceFor().plan();

			expect(
				result.isErr() &&
					result.error instanceof DiagnosticsError &&
					result.error.diagnostics
			).toMatchObject([{ code: "init.configExists" }]);
		});

		it("should add it beside a config when it can't ask, as Enter would", async () => {
			await write("rogen.jsonc", "{}");

			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.files.map(({ fileName }) => fileName)).toEqual([
				"AGENTS.md",
			]);
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
			(await serviceFor(prompts).plan()).unwrap();
		const fileOf = (
			plan: { files: readonly PlannedFile[] } | undefined,
			name: string
		) => plan?.files.find(({ fileName }) => fileName === name);

		it("should offer it where an agent is in use, and write the script and the agent's file", async () => {
			await write(".claude/keep", "");

			const plan = await planned();

			expect(names(plan)).toEqual([
				"rogen.json",
				"AGENTS.md",
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

		it("should write one script and a file for each agent in use", async () => {
			await write(".claude/keep", "");
			await write(".codex/keep", "");
			await write("GEMINI.md", "");
			await write(".cursor/keep", "");
			await write(".github/copilot-instructions.md", "");

			const plan = await planned();

			expect(names(plan)).toEqual([
				"rogen.json",
				"AGENTS.md",
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
				"AGENTS.md",
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

			expect(names(plan)).toEqual(["rogen.json", "AGENTS.md", CODEX]);
		});

		it("should leave a file that is not plain JSON alone, and say so", async () => {
			await write(CLAUDE, "{ // mine\n}");
			await write(".codex/keep", "");

			const plan = await planned();

			expect(names(plan)).toEqual([
				"rogen.json",
				"AGENTS.md",
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

			const plan = await planned(new MockPromptService(["hook"]));

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

	describe("plan", () => {
		it("should take every default when it can't ask", async () => {
			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.files.map(({ fileName }) => fileName)).toEqual([
				"rogen.json",
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

			it("should fail naming the config when there is nothing left to add", async () => {
				await write("AGENTS.md", agentBlock);
				await write("rogen.json", "{}");

				const result = await serviceFor(
					new MockPromptService([])
				).plan();

				expect(
					result.isErr() &&
						result.error instanceof DiagnosticsError &&
						result.error.diagnostics
				).toMatchObject([
					{
						code: "init.configExists",
						resource: path.join(directory, "rogen.json"),
						message:
							"this config already exists. Delete it to write a new one.",
					},
				]);
			});
		});
	});

	describe("write", () => {
		const planned = async (): Promise<InitPlan> =>
			(await serviceFor().plan()).unwrap() as InitPlan;

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
