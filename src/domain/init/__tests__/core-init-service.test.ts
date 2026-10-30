import { agentBlock } from "../agent/agent-block.js";
import { hookScript } from "../agent/hook-script.js";
import { PlannedFile } from "../../toolchain/toolchain.js";
import { jest } from "@jest/globals";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import path from "path";
import { ResultError, ok } from "../../../base/result.js";
import { UsageError } from "../../../base/errors.js";
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
	PromptService,
	SelectPromptOptions,
} from "../../../platform/prompt/prompt-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import {
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { CoreInitService } from "../core-init-service.js";
import { MigratedProject } from "../project-migration.js";
import { InitChoices, InitPlan, InitWritten } from "../init-service.js";

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

	confirm(options: ConfirmPromptOptions): Promise<boolean | undefined> {
		return this.once(options.message, () => this.inner.confirm(options));
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
		configs = new CoreConfigService(
			fileSystem,
			new NativeEnvironmentService({}, directory)
		);
		processes.installed.set("rojo", "/bin/rojo");
		processes.outputs.set("/bin/rojo", ROJO_VERSION);
		await fileSystem.createDirectory(directory);
	});

	let configs: CoreConfigService;

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
			processes,
			undefined,
			configs
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

		it.each([
			"default.rogen.json",
			"default.rogen.jsonc",
			"game.rogen.json",
		])(
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
							"rogen init --agent-rules"
						),
					},
				]);
			}
		);

		it("should fail with what a folder check finds, and write nothing", async () => {
			await write(".rogen.json", "{}");
			configs.registerFolderCheck(async (folder) => [
				errorDiagnostic(
					"stale.config",
					{ resource: path.join(folder, ".rogen.json") },
					"is old."
				),
			]);

			expect(
				await refused(new MockPromptService([]), { ask: false })
			).toMatchObject([
				{
					code: "stale.config",
					resource: path.join(directory, ".rogen.json"),
				},
			]);
		});

		it("should plan only the agent rules where a config exists and --agent-rules is all that is given", async () => {
			await write("default.rogen.json", "{}");

			const plan = (
				await serviceFor(new MockPromptService([])).plan({
					choices: { agentRules: true },
				})
			).unwrap();

			expect(plan?.files).toEqual([
				{ fileName: "AGENTS.md", content: agentBlock },
			]);
			expect(plan?.configs).toEqual([]);
		});

		it("should plan only the agent rules where a config exists and --skip-git comes with --agent-rules", async () => {
			await write("default.rogen.json", "{}");

			const plan = (
				await serviceFor(new MockPromptService([])).plan({
					ask: false,
					choices: { agentRules: true, skipGit: true },
				})
			).unwrap();

			expect(plan?.files).toEqual([
				{ fileName: "AGENTS.md", content: agentBlock },
			]);
		});

		it.each([
			[{ language: "luau" }, "--language"],
			[{ places: false }, "--no-places"],
			[{ kind: "model" as const }, "--kind model"],
			[{ sample: false as const }, "--no-sample"],
		])(
			"should be a usage error when %o comes with an agent flag, naming %s",
			async (shaping, flag) => {
				await write("default.rogen.json", "{}");

				const result = await serviceFor(new MockPromptService([])).plan(
					{
						choices: {
							agentRules: true,
							...shaping,
						},
					}
				);

				expect(result.isErr() && result.error).toBeInstanceOf(
					UsageError
				);
				expect(result.isErr() && result.error.message).toContain(flag);
				expect(result.isErr() && result.error.message).toContain(
					"default.rogen.json"
				);
			}
		);

		it("should fail with init.configExists when a project flag comes alone", async () => {
			await write("default.rogen.json", "{}");

			const diagnostics = await refused(new MockPromptService([]), {
				choices: { language: "luau", agentRules: false },
			});

			expect(diagnostics).toMatchObject([{ code: "init.configExists" }]);
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

		it("should import AGENTS.md into a CLAUDE.md that doesn't", async () => {
			await write("AGENTS.md", "");
			await write("CLAUDE.md", "Use tabs.\n");

			const plan = (await serviceFor().plan()).unwrap();

			expect(
				plan?.files.find(({ fileName }) => fileName === "CLAUDE.md")
					?.content
			).toBe("Use tabs.\n\n@AGENTS.md\n");
		});

		it("should write a GEMINI.md that imports AGENTS.md where Gemini CLI is in use", async () => {
			await write(".gemini/keep", "");

			const plan = (await serviceFor().plan()).unwrap();

			expect(
				plan?.files.find(({ fileName }) => fileName === "GEMINI.md")
			).toEqual({ fileName: "GEMINI.md", content: "@AGENTS.md\n" });
		});
	});

	describe("agent hook", () => {
		const SCRIPT = ".agents/hooks/rogen-check.mjs";
		const CLAUDE = ".claude/settings.json";
		const CODEX = ".codex/hooks.json";
		const answersEverything = () => new MockPromptService({});
		const names = (plan: { files: readonly PlannedFile[] } | undefined) =>
			plan?.files.map(({ fileName }) => fileName);
		const planned = async (
			prompts = answersEverything(),
			choices: InitChoices = { sample: false, agentHook: true }
		) => (await serviceFor(askingEach(prompts)).plan({ choices })).unwrap();
		const asking = (prompts: MockPromptService) =>
			planned(prompts, { sample: false });
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
										'node "$CLAUDE_PROJECT_DIR"/.agents/hooks/rogen-check.mjs',
								},
							],
						},
					],
				},
			});
		});

		it("should leave it out when the plan is created as shown, and say how to add it", async () => {
			await write(".claude/keep", "");

			const plan = (
				await serviceFor(new MockPromptService({})).plan({
					choices: { sample: false },
				})
			).unwrap();

			expect(names(plan)).not.toContain(SCRIPT);
			expect(names(plan)).not.toContain(CLAUDE);
			expect(plan?.notes).toContain(
				"Claude Code is in use here. 'rogen init --agent-hook' adds a hook that reports Rogen's warnings when it ends its turn."
			);
			expect(plan?.nextSteps.edits.join("\n")).not.toContain(
				"--agent-hook"
			);
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
				"GEMINI.md",
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

			const plan = await asking(prompts);

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

			await asking(prompts);

			expect(prompts.asked.at(-1)).toBe(
				"Add a hook that reports Rogen warnings to Claude Code and Codex?"
			);
		});

		it("should leave it out under Customise unless the question is answered yes", async () => {
			await write(".claude/keep", "");
			const accepted = new MockPromptService({
				"Add a hook that reports Rogen warnings to Claude Code?": true,
			});

			const taken = await asking(answersEverything());
			const added = await asking(accepted);

			expect(names(taken)).not.toContain(SCRIPT);
			expect(names(added)).toContain(SCRIPT);
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
						Stop: [{ hooks: [{ command: "x/rogen-check.mjs" }] }],
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
						Stop: [{ hooks: [{ command: "x/rogen-check.mjs" }] }],
					},
				})
			);

			const plan = await planned();

			expect(names(plan)).not.toContain(SCRIPT);
			expect(plan?.notes).toContain(
				"The Rogen hook is registered for Claude Code already."
			);
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
				".claude/settings.json isn't plain JSON, so it was left alone. Register .agents/hooks/rogen-check.mjs in it by hand: https://rogen-roblox.vercel.app/docs/v2/agents",
			]);
		});

		it("should not offer it when the only file is not plain JSON, but still say so", async () => {
			await write(CLAUDE, "{ // mine\n}");

			const plan = await planned();

			expect(names(plan)).not.toContain(SCRIPT);
			expect(plan?.notes).toEqual([
				".claude/settings.json isn't plain JSON, so it was left alone. Register .agents/hooks/rogen-check.mjs in it by hand: https://rogen-roblox.vercel.app/docs/v2/agents",
			]);
		});

		it("should say what the script needs, and what an agent asks of the user", async () => {
			await write(".claude/keep", "");
			await write(".codex/keep", "");

			const plan = await planned();

			expect(plan?.nextSteps.setup).toEqual([
				"The hook runs the Rogen in node_modules/.bin, else the one on the PATH; install Rogen in the project or globally.",
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
		it("should set up nothing of Darklua's in a new project, where Darklua is found", async () => {
			processes.installed.delete("rojo");
			processes.installed.set("rokit", "/bin/rokit");
			await write(".darklua.json", "{}");

			const plan = (
				await serviceFor().plan({
					ask: false,
					choices: { sample: false, agentRules: false },
				})
			).unwrap();

			expect(plan?.files.map(({ fileName }) => fileName).sort()).toEqual([
				".gitignore",
				"default.rogen.json",
				"rokit.toml",
			]);
			expect(
				plan?.files.find(({ fileName }) => fileName === "rokit.toml")
					?.content
			).toBe('[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n');
			expect(plan?.decided.map(({ question }) => question)).not.toContain(
				"darklua"
			);
		});

		describe("lifting a project whose processor writes a folder of its own", () => {
			const HAND_WRITTEN = {
				name: "mine",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Shared: { $path: "build/shared" } },
					ServerScriptService: { Server: { $path: "build/server" } },
				},
			};

			const liftPlan = async () => {
				await write(
					"default.project.json",
					JSON.stringify(HAND_WRITTEN)
				);
				await write("src/shared/Util.luau");
				await write("src/server/Main.server.luau");
				await write("build/shared/Util.luau");
				await write("build/server/Main.server.luau");
				return (
					await serviceFor().plan({
						ask: false,
						choices: { agentRules: false },
					})
				).unwrap();
			};

			const configIn = (plan: InitPlan | undefined, fileName: string) =>
				JSON.parse(
					plan?.files.find((file) => file.fileName === fileName)
						?.content ?? "null"
				);

			it("should root the default at the source and read the folder in dist.rogen.json", async () => {
				await write(".darklua.json", "{}");

				const plan = await liftPlan();

				expect(configIn(plan, "default.rogen.json")).toEqual({
					name: "mine",
					sourcePaths: ["src"],
					routes: {
						Shared: "ReplicatedStorage/Shared",
						Server: "ServerScriptService/Server",
						Client: "StarterPlayer/StarterPlayerScripts",
						"*": "ReplicatedStorage/Shared",
					},
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {},
						ServerScriptService: {},
					},
				});
				expect(configIn(plan, "dist.rogen.json")).toEqual({
					...configIn(plan, "default.rogen.json"),
					compiledPath: "build",
				});
				expect(plan?.warnings).toEqual([]);
			});

			it("should say what it took from the project file and serve the processed config", async () => {
				await write(".darklua.json5", "{}");

				const plan = await liftPlan();

				expect(plan?.notes).toContain(
					'Took build as the folder Darklua writes, since .darklua.json5 is here and the mounts of default.project.json into build repeat src. default.rogen.json reads src, and dist.rogen.json reads build as its "compiledPath".'
				);
				expect(plan?.nextSteps.run).toEqual(["rogen serve dist"]);
			});

			it("should keep the mounts, with a note, when no processor config says who writes the folder", async () => {
				const plan = await liftPlan();

				expect(
					configIn(plan, "default.rogen.json").tree
						.ServerScriptService
				).toEqual({ Server: { $path: "build/server" } });
				expect(configIn(plan, "dist.rogen.json")).toBeNull();
				expect(plan?.notes).toContain(
					'Kept the mounts of default.project.json into build, which repeat src, since no .darklua.json says a processor writes build. Rojo now syncs a script there twice: from build and from its route. If a processor writes build, remove those mounts and serve a copy of default.rogen.json with "compiledPath": "build".'
				);
				expect(plan?.nextSteps.run).toEqual(["rogen serve"]);
				expect(plan?.warnings).toEqual([]);
			});

			it("should leave a package folder alone", async () => {
				await write(".darklua.json", "{}");
				await write(
					"default.project.json",
					JSON.stringify({
						tree: {
							$className: "DataModel",
							ReplicatedStorage: {
								Packages: { $path: "Packages" },
								Shared: { $path: "src/shared" },
							},
						},
					})
				);
				await write("src/shared/Util.luau");
				await write("Packages/Promise.lua");

				const plan = (
					await serviceFor().plan({
						ask: false,
						choices: { agentRules: false },
					})
				).unwrap();

				expect(configIn(plan, "dist.rogen.json")).toBeNull();
				expect(
					configIn(plan, "default.rogen.json").tree.ReplicatedStorage
				).toEqual({ Packages: { $path: "Packages" } });
			});
		});
	});

	describe("source paths", () => {
		const planOf = async () =>
			(
				await serviceFor().plan({
					ask: false,
					choices: { agentRules: false },
				})
			).unwrap();

		const configOf = (plan: InitPlan | undefined) =>
			JSON.parse(
				plan?.files.find(
					({ fileName }) => fileName === "default.rogen.json"
				)?.content ?? "null"
			);

		const lift = (tree: object) =>
			write(
				"default.project.json",
				JSON.stringify({
					name: "mine",
					tree: { $className: "DataModel", ...tree },
				})
			);

		it("should take the closest folder that holds every folder of code the project file mounts", async () => {
			await lift({
				ServerScriptService: { Server: { $path: "code/server" } },
				StarterPlayer: {
					StarterPlayerScripts: {
						Client: { $path: "code/client" },
					},
				},
			});
			await write("code/server/Main.server.luau");
			await write("code/client/Main.client.luau");
			await write("src/.gitkeep");

			const plan = await planOf();

			expect(configOf(plan)).toMatchObject({
				sourcePaths: ["code"],
				routes: {
					Server: "ServerScriptService/Server",
					Client: "StarterPlayer/StarterPlayerScripts/Client",
				},
			});
			expect(plan?.warnings).toEqual([]);
		});

		it("should take the parent of a lone mounted folder named after a route, when its route places the files there", async () => {
			await lift({
				ServerScriptService: { Server: { $path: "src/server" } },
			});
			await write("src/server/Main.server.luau");
			await write("src/server/Admin/Ban.luau");

			const plan = await planOf();

			expect(configOf(plan)).toMatchObject({
				sourcePaths: ["src"],
				routes: { Server: "ServerScriptService/Server" },
				tree: { $className: "DataModel", ServerScriptService: {} },
			});
			expect(plan?.warnings).toEqual([]);
		});

		it("should keep a lone folder named after a route at the top of the project in the tree, with a note", async () => {
			const tree = {
				ServerScriptService: { Server: { $path: "server" } },
			};
			await lift(tree);
			await write("server/Main.server.luau");

			const plan = await planOf();

			expect(configOf(plan)).toMatchObject({
				sourcePaths: ["src"],
				tree: { $className: "DataModel", ...tree },
			});
			expect(plan?.notes).toContainEqual(
				expect.stringMatching(/^Kept the mounts of server in the tree/)
			);
			expect(plan?.warnings).toEqual([]);
		});

		it("should keep folders mounted at the top of the project in the tree, with a note", async () => {
			const tree = {
				ServerScriptService: { Server: { $path: "server" } },
				StarterPlayer: {
					StarterPlayerScripts: { Client: { $path: "client" } },
				},
				ReplicatedStorage: { Shared: { $path: "shared" } },
			};
			await lift(tree);
			await write("server/Main.server.luau");
			await write("client/Main.client.luau");
			await write("shared/Util.luau");

			const plan = await planOf();

			expect(configOf(plan)).toMatchObject({
				sourcePaths: ["src"],
				tree: { $className: "DataModel", ...tree },
			});
			expect(plan?.notes).toContain(
				"Kept the mounts of client, server and shared in the tree as they are: only the project's own folder holds them all, and a source path is a folder below it. To route their code, move the folders into src."
			);
			expect(plan?.warnings).toEqual([]);
		});

		it("should never take the project's own folder or a package folder", async () => {
			await lift({
				Workspace: { Map: { $path: "." } },
				ReplicatedStorage: {
					Packages: { $path: "Packages" },
					Shared: { $path: "code/shared" },
				},
				ServerScriptService: { Server: { $path: "code/server" } },
			});
			await write("wally.toml");
			await write("Packages/Promise.luau");
			await write("code/shared/Util.luau");
			await write("code/server/Main.server.luau");

			expect(configOf(await planOf()).sourcePaths).toEqual(["code"]);
		});

		it("should take roblox-ts's source path from the rootDir of tsconfig.json", async () => {
			await write(
				"tsconfig.json",
				JSON.stringify({
					compilerOptions: { rootDir: "game", outDir: "out" },
				})
			);
			await lift({
				ServerScriptService: { Server: { $path: "out/server" } },
				ReplicatedStorage: { Shared: { $path: "out/shared" } },
			});
			await write("game/server/main.server.ts");
			await write("out/server/main.server.luau");
			await write("out/shared/util.luau");

			expect(configOf(await planOf())).toMatchObject({
				sourcePaths: ["game"],
				compiledPath: "out",
			});
		});

		it("should warn of code that no source path holds, by code", async () => {
			await write("game/Main.server.luau");
			await write("lib/Util.luau");

			const plan = await planOf();

			expect(configOf(plan).sourcePaths).toEqual(["src"]);
			expect(plan?.warnings).toEqual([
				warningDiagnostic(
					"init.codeOutsideSourcePaths",
					{ resource: "default.rogen.json" },
					`game and lib hold code that no source path holds and the tree doesn't mount, so Rogen places none of it. Move the code into src, or list its folders under "sourcePaths" in default.rogen.json.`
				),
			]);
		});

		it("should warn of code that neither a source path holds nor the tree mounts in a lifted project", async () => {
			await lift({
				ServerScriptService: { Admin: { $path: "src/server/Admin" } },
				ReplicatedStorage: { Packages: { $path: "Packages" } },
			});
			await write("wally.toml");
			await write("Packages/Promise.luau");
			await write("src/server/Admin/Ban.luau");
			await write("src/server/Main.server.luau");

			const plan = await planOf();

			expect(configOf(plan).sourcePaths).toEqual(["src/server/Admin"]);
			expect(plan?.warnings.map(({ message }) => message)).toEqual([
				expect.stringMatching(
					/^src\/server\/Main\.server\.luau holds code that no source path holds/
				),
			]);
		});
	});

	describe("Rojo", () => {
		const PIN = "rojo-rbx/rojo@7.7.1";
		const PLUGIN_LINE =
			"Run 'rogen plugin install' to install Rojo's Studio plugin.";
		const names = (plan: { files: readonly PlannedFile[] } | undefined) =>
			plan?.files.map(({ fileName }) => fileName);
		const fileOf = (
			plan: { files: readonly PlannedFile[] } | undefined,
			name: string
		) => plan?.files.find(({ fileName }) => fileName === name);

		beforeEach(() => {
			processes.installed.delete("rojo");
		});

		it("should do nothing when Rojo runs", async () => {
			processes.installed.set("rojo", "/bin/rojo");
			processes.outputs.set("/bin/rojo", ROJO_VERSION);
			processes.installed.set("rokit", "/bin/rokit");

			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.nextSteps.setup).toEqual([]);
			expect(names(plan)).not.toContain("rokit.toml");
			expect(plan?.summary).toContainEqual({
				area: "Rojo",
				text: "ready",
			});
		});

		it("should write the pin into a new file of the manager found, and name its install command", async () => {
			processes.installed.set("rokit", "/bin/rokit");

			const plan = (await serviceFor().plan()).unwrap();

			expect(fileOf(plan, "rokit.toml")).toEqual({
				fileName: "rokit.toml",
				content: `[tools]\nrojo = "${PIN}"\n`,
			});
			expect(plan?.commands).toEqual([]);
			expect(plan?.nextSteps.setup).toEqual([
				"Run 'rokit install' to install Rojo.",
				PLUGIN_LINE,
			]);
			expect(plan?.summary).toContainEqual({
				area: "Rojo",
				text: "pin Rojo 7.7.1 in rokit.toml",
			});
		});

		it("should add to the Rokit file that is there, keeping what it has", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			await write(
				"rokit.toml",
				'[tools]\nwally = "UpliftGames/wally@0.3.2"\n'
			);

			const plan = (await serviceFor().plan()).unwrap();

			expect(fileOf(plan, "rokit.toml")).toEqual({
				fileName: "rokit.toml",
				content: `[tools]\nwally = "UpliftGames/wally@0.3.2"\nrojo = "${PIN}"\n`,
				addition: "Rojo's pin",
			});
		});

		it("should use Aftman for Aftman alone", async () => {
			processes.installed.set("aftman", "/bin/aftman");

			const plan = (await serviceFor().plan()).unwrap();

			expect(fileOf(plan, "aftman.toml")?.content).toBe(
				`[tools]\nrojo = "${PIN}"\n`
			);
			expect(plan?.nextSteps.setup[0]).toBe(
				"Run 'aftman install' to install Rojo."
			);
		});

		it("should write Foreman's line itself and name foreman install", async () => {
			processes.installed.set("foreman", "/bin/foreman");
			await write("foreman.toml", "[tools]\n");

			const plan = (await serviceFor().plan()).unwrap();

			expect(fileOf(plan, "foreman.toml")).toEqual({
				fileName: "foreman.toml",
				content:
					'[tools]\nrojo = { github = "rojo-rbx/rojo", version = "7.7.1" }\n',
				addition: "Rojo's pin",
			});
			expect(plan?.nextSteps.setup[0]).toBe(
				"Run 'foreman install' to install Rojo."
			);
		});

		it("should write rokit.toml and print Rokit's installer when no manager is installed", async () => {
			const plan = (await serviceFor().plan()).unwrap();

			expect(fileOf(plan, "rokit.toml")?.content).toBe(
				`[tools]\nrojo = "${PIN}"\n`
			);
			expect(plan?.commands).toEqual([]);
			expect(plan?.nextSteps.setup[0]).toMatch(
				/^Install Rokit with '.*rojo-rbx\/rokit\/main\/scripts\/install.*' \(https:\/\/github\.com\/rojo-rbx\/rokit\), then run 'rokit install' here\.$/
			);
			expect(plan?.nextSteps.setup[1]).toBe(PLUGIN_LINE);
		});

		it("should still add the pin to the folder's manager file when that manager is not installed", async () => {
			await write("aftman.toml", "[tools]\n");

			const plan = (await serviceFor().plan()).unwrap();

			expect(fileOf(plan, "aftman.toml")).toMatchObject({
				content: `[tools]\nrojo = "${PIN}"\n`,
				addition: "Rojo's pin",
			});
			expect(names(plan)).not.toContain("rokit.toml");
			expect(plan?.nextSteps.setup[0]).toBe(
				"Install Aftman (https://github.com/LPGhatguy/aftman), then run 'aftman install' here."
			);
		});

		it("should run nothing, and decide nothing about it, in a run that can't ask", async () => {
			processes.installed.set("rokit", "/bin/rokit");

			const plan = (await serviceFor().plan()).unwrap();

			expect(plan?.commands).toEqual([]);
			expect(
				plan?.decided.filter(({ flag }) => /rojo|studio/.test(flag))
			).toEqual([]);
		});

		it("should ask nothing about it in a terminal", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			const prompts = new MockPromptService({});

			await serviceFor(askingEach(prompts)).plan();

			expect(prompts.asked.join("\n")).not.toMatch(/Pin|Install|Rokit/);
		});

		it("should not pin it once Rojo is pinned, here or above", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			await write("rokit.toml", "[tools]\n");
			await fileSystem.writeFile(
				path.resolve("/mock/aftman.toml"),
				`[tools]\nrojo = "${PIN}"\n`
			);

			const plan = (await serviceFor().plan()).unwrap();

			expect(fileOf(plan, "rokit.toml")).toBeUndefined();
			expect(plan?.nextSteps.setup).toEqual([]);
		});

		it("should not pin it when the file uses the name rojo for another tool", async () => {
			processes.installed.set("rokit", "/bin/rokit");
			await write("rokit.toml", '[tools]\nrojo = "someone/fork@1.0.0"\n');

			const plan = (await serviceFor().plan()).unwrap();

			expect(fileOf(plan, "rokit.toml")).toBeUndefined();
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
				tree: { $path: "src" },
			});
			expect(plan?.nextSteps.run).toEqual([
				'rogen build -o "my-game.rbxmx"',
			]);
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

		it("should take no source path when a lifted project takes no routes, and name none in the steps", async () => {
			await write("tsconfig.json", "{}");
			await write(
				"default.project.json",
				JSON.stringify({ name: "lib", tree: { $path: "src" } })
			);

			const plan = (await serviceFor().plan()).unwrap();

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
				"place/Lighting/init.meta.json",
				"place/SoundService/init.meta.json",
				"place/Workspace/Baseplate.model.json",
				"place/Workspace/init.meta.json",
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
				"Lifting default.project.json into default.rogen.json, since Rogen replaces default.project.json on every write.",
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
			expect(shown).not.toContain("Darklua");
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
				"several",
				ACCEPT_DEFAULT,
				"yes",
			]);

			const plan = (await review(prompts)).unwrap();

			expect(prompts.asked).toEqual([
				"Language",
				"One place or several?",
				CREATE,
				"Language",
				"One place or several?",
				"Add Rogen's rules for coding agents to AGENTS.md?",
				CREATE,
			]);
			expect(prompts.prompts.at(-1)?.description).toContain(
				"several places"
			);
			expect(plan?.summary).toContainEqual({
				area: "Project",
				text: expect.stringContaining("several places"),
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

			expect(written).toContain("rokit.toml");
			expect(written.length).toBeGreaterThan(5);
			for (const item of written) expect(shown).toContain(item);
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

	describe("a registered migration", () => {
		const migrated = (
			changes: Partial<MigratedProject> = {}
		): MigratedProject => ({
			label: "an old config",
			from: ["old.rogen.json"],
			configs: [
				{
					fileName: "old.rogen.json",
					config: {
						sourcePaths: ["src"],
						routes: { Server: "ServerScriptService/server" },
					},
				},
			],
			moves: [
				{ from: "old.rogen.json", to: "old.rogen.json.v1" },
				{ from: "src/A_Server.luau", to: "src/A@Server.luau" },
			],
			notes: ["Took the tree from the old config."],
			warnings: [
				warningDiagnostic(
					"old.tags",
					{ resource: path.join(directory, "old.rogen.json") },
					"tags are gone."
				),
			],
			edits: ["Run 'rogen check' and fix what it reports."],
			...changes,
		});

		const migrating = (
			project: MigratedProject | undefined = migrated(),
			promptService?: PromptService
		) => {
			const service = serviceFor(promptService);
			const asked: string[] = [];
			const registration = service.registerMigration({
				find: async (folder) => {
					asked.push(folder);
					return ok(project);
				},
			});
			return { service, asked, registration };
		};

		beforeEach(async () => {
			await write("old.rogen.json", '{ "source": "src" }');
			await write("src/A_Server.luau", "return {}");
		});

		it("should plan its configs, moves, notes and warnings in place of a new project", async () => {
			const { service } = migrating();

			const plan = (await service.plan({ ask: false })).unwrap()!;

			expect(plan.moves).toEqual(migrated().moves);
			expect(plan.configs).toEqual(["old.rogen.json"]);
			expect(
				JSON.parse(
					plan.files.find(
						({ fileName }) => fileName === "old.rogen.json"
					)?.content ?? "{}"
				)
			).toEqual(migrated().configs[0].config);
			expect(plan.files.map(({ fileName }) => fileName)).not.toContain(
				".gitignore"
			);
			expect(plan.notes).toContain("Took the tree from the old config.");
			expect(plan.warnings.map(({ code }) => code)).toEqual(["old.tags"]);
			expect(plan.nextSteps.edits[0]).toBe(
				"Run 'rogen check' and fix what it reports."
			);
			expect(plan.nextSteps.run).toEqual(["rogen serve old"]);
		});

		it("should come before the folder's stale configs that it covers", async () => {
			configs.registerFolderCheck(async (folder) => [
				errorDiagnostic(
					"stale.config",
					{ resource: path.join(folder, "old.rogen.json") },
					"is old."
				),
			]);

			expect(
				(await migrating().service.plan({ ask: false })).isOk()
			).toBe(true);
		});

		it("should still stop for a stale config it doesn't cover", async () => {
			configs.registerFolderCheck(async (folder) => [
				errorDiagnostic(
					"stale.config",
					{ resource: path.join(folder, "other.rogen.json") },
					"is old."
				),
			]);

			const planned = await migrating().service.plan({ ask: false });

			expect(
				planned.isErr() &&
					planned.error instanceof DiagnosticsError &&
					planned.error.diagnostics.map(({ code }) => code)
			).toEqual(["stale.config"]);
		});

		it("should refuse a flag that shapes a new config", async () => {
			const planned = await migrating().service.plan({
				ask: false,
				choices: { language: "luau" },
			});

			expect(planned.isErr() && planned.error).toBeInstanceOf(UsageError);
		});

		it("should show every rename before it asks", async () => {
			const prompts = new MockPromptService([ACCEPT_DEFAULT], true);

			(await migrating(undefined, prompts).service.plan()).unwrap();

			expect(
				prompts.prompts.at(-1)?.description?.replace(/\s+/g, " ")
			).toContain("src/A_Server.luau → src/A@Server.luau");
		});

		it("should move the files before it writes, and move nothing in a dry run", async () => {
			const { service } = migrating();
			const plan = (await service.plan({ ask: false })).unwrap()!;
			const written: InitWritten[] = [];

			(await service.write(plan, () => {}, true)).unwrap();
			expect(
				await fileSystem.exists(
					path.join(directory, "src/A@Server.luau")
				)
			).toBe(false);
			(await service.write(plan, (item) => written.push(item))).unwrap();

			expect(written.slice(0, 2)).toEqual(
				plan.moves.map((move) => ({ kind: "move", move }))
			);
			expect(
				await fileSystem.readFile(
					path.join(directory, "old.rogen.json.v1")
				)
			).toBe('{ "source": "src" }');
			expect(
				JSON.parse(
					await fileSystem.readFile(
						path.join(directory, "old.rogen.json")
					)
				)
			).toMatchObject({ sourcePaths: ["src"] });
			expect(
				await fileSystem.exists(
					path.join(directory, "src/A@Server.luau")
				)
			).toBe(true);
		});

		it("should plan a new project once it is removed", async () => {
			await fileSystem.delete(path.join(directory, "old.rogen.json"));
			const { service, asked, registration } = migrating();
			registration[Symbol.dispose]();

			const plan = (await service.plan({ ask: false })).unwrap()!;

			expect(asked).toEqual([]);
			expect(plan.moves).toEqual([]);
		});
	});
});
