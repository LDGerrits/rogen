import { Result } from "../../../base/result.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import {
	CANCEL,
	MockPromptService,
	PromptScript,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { withRobloxTs } from "../../toolchain/__tests__/workspaces.js";
import { InitQuestions } from "../init-questions.js";
import { ProjectChoices, ProjectSetup } from "../project-setup.js";
import path from "path";
import {
	DirectorySpec,
	WorkspaceSpec,
	directory,
	directoryOf,
} from "./init-fixtures.js";

type Context = DirectorySpec;

const askInitChoices = async (
	prompts: MockPromptService,
	context: Context
): Promise<Result<ProjectChoices | undefined, Diagnostic[]>> => {
	const fileSystem = new MemoryFileSystemService();
	await fileSystem.createDirectory(directory);
	for (const file of context.existing ?? [])
		await fileSystem.writeFile(path.join(directory, file), "{}");
	const setup = new ProjectSetup(
		directoryOf(context),
		new InitQuestions(prompts, prompts.isInteractive, { sample: false }),
		fileSystem
	);
	return setup.ask();
};

const defaultInitChoices = async (
	workspace: WorkspaceSpec,
	existing: readonly string[] = []
) =>
	(
		await askInitChoices(new MockPromptService([], false), {
			workspace,
			existing,
		})
	).unwrap();

const luau: WorkspaceSpec = {};
const rbxts: WorkspaceSpec = {
	language: "roblox-ts",
	robloxTs: {
		outDir: "build",
		rbxtsScopes: ["@rbxts"],
		includeInstalled: true,
	},
	packageManager: "wally",
	packageDirs: ["Packages"],
};

const contextOf = (
	workspace: WorkspaceSpec,
	existing: readonly string[] = []
): Context => ({ workspace, existing });

const ask = (
	workspace: WorkspaceSpec,
	answers: PromptScript,
	existing: readonly string[] = []
) =>
	askInitChoices(
		new MockPromptService(answers),
		contextOf(workspace, existing)
	);

const asked = async (...args: Parameters<typeof ask>) => {
	const choices = (await ask(...args)).unwrap();
	if (!choices) throw new Error("The questions were cancelled.");
	return choices;
};

describe("InitQuestions askProject", () => {
	it("should give an unattended run the choices a user accepting every default gets", async () => {
		for (const workspace of [
			rbxts,
			luau,
			{ ...luau, packageManager: "pesde" as const },
		]) {
			expect(await asked(workspace, {})).toEqual(
				await defaultInitChoices(workspace)
			);
		}
	});

	it("should ask only the language, and mount the installed packages", async () => {
		const prompts = new MockPromptService({});

		const choices = (
			await askInitChoices(prompts, contextOf(rbxts))
		).unwrap();

		expect(prompts.asked).toEqual(["Language"]);
		expect(choices?.mounts.map(({ path }) => path)).toEqual([
			"include",
			"node_modules/@rbxts",
			"Packages",
			"ServerPackages",
		]);
	});

	describe("language", () => {
		it("should preselect the detected language", async () => {
			expect((await asked(rbxts, {})).language.id).toBe("roblox-ts");
			expect((await asked(luau, {})).language.id).toBe("luau");
		});

		it("should take the language that was chosen", async () => {
			const choices = await asked(luau, { Language: "roblox-ts" });

			expect(choices.language.id).toBe("roblox-ts");
			expect(choices.compiledPath).toBe("out");
		});
	});

	describe("compiled path", () => {
		const compiledPathPrompt = (prompts: MockPromptService) =>
			prompts.prompts.find(({ message }) => message === "Compiled path");

		it("should be skipped for plain luau", async () => {
			const prompts = new MockPromptService({});

			await askInitChoices(prompts, contextOf(luau));

			expect(compiledPathPrompt(prompts)).toBeUndefined();
		});

		it("should not be asked for roblox-ts, which syncs from its outDir", async () => {
			const prompts = new MockPromptService({});

			const result = await askInitChoices(prompts, contextOf(rbxts));

			expect(compiledPathPrompt(prompts)).toBeUndefined();
			expect(result.unwrap()?.compiledPath).toBe("build");
		});
	});

	describe("source paths", () => {
		it("should take the folder roblox-ts compiles from tsconfig.json", async () => {
			const choices = await asked(
				{
					...withRobloxTs(rbxts, { sourcePath: "./game" }),
					hasSrc: true,
				},
				{}
			);

			expect(choices.sourcePaths).toEqual(["game"]);
		});

		it("should ignore the tsconfig sourcePath for luau", async () => {
			const choices = await asked(
				{ ...withRobloxTs(luau, { sourcePath: "game" }), hasSrc: true },
				{}
			);

			expect(choices.sourcePaths).toEqual(["src"]);
		});
	});

	describe("packages", () => {
		const mountedFor = async (workspace: WorkspaceSpec) =>
			(await asked(workspace, {})).mounts;

		it("should mount the package folders when the manifest exists, installed or not", async () => {
			expect(
				await mountedFor({
					...luau,
					packageManager: "wally",
					packageDirs: new Set(["Packages"]),
				})
			).toEqual([
				{
					path: "Packages",
					optional: false,
					landing: "ReplicatedStorage/Packages",
				},
				{
					path: "ServerPackages",
					optional: true,
					landing: "ServerScriptService/ServerPackages",
				},
			]);
		});

		it("should mount nothing when there is no package manager and no package folder", async () => {
			expect(await mountedFor(luau)).toEqual([]);
		});

		it("should mount a package folder that exists without a manifest", async () => {
			expect(
				(
					await mountedFor({
						...luau,
						packageDirs: new Set(["Packages"]),
					})
				).map(({ path }) => path)
			).toEqual(["Packages"]);
		});

		it("should mount only pesde's folders when pesde is detected", async () => {
			expect(
				(await mountedFor({ ...luau, packageManager: "pesde" })).map(
					({ path }) => path
				)
			).toEqual(["roblox_packages", "roblox_server_packages"]);
		});

		it("should never mount include or an @ scope for luau", async () => {
			expect(
				(
					await mountedFor(
						withRobloxTs(
							{ ...luau, packageManager: "wally" },
							{
								includeInstalled: true,
								rbxtsScopes: ["@rbxts", "@flamework"],
							}
						)
					)
				).map(({ path }) => path)
			).toEqual(["Packages", "ServerPackages"]);
		});

		it("should always mount include and @rbxts for roblox-ts, with the extra scopes it found", async () => {
			expect(
				(
					await mountedFor(
						withRobloxTs(
							{ ...luau, language: "roblox-ts" },
							{ rbxtsScopes: ["@rbxts", "@flamework"] }
						)
					)
				).map(({ path, landing }) => [path, landing])
			).toEqual([
				["include", "ReplicatedStorage/rbxts_include"],
				[
					"node_modules/@rbxts",
					"ReplicatedStorage/rbxts_include/node_modules/@rbxts",
				],
				[
					"node_modules/@flamework",
					"ReplicatedStorage/rbxts_include/node_modules/@flamework",
				],
			]);
		});
	});

	it("should resolve undefined when the language question is cancelled", async () => {
		expect((await ask(rbxts, [CANCEL])).unwrap()).toBeUndefined();
	});
});

describe("InitQuestions askProject project file", () => {
	const askBeside = async (existing: readonly string[]) => {
		const prompts = new MockPromptService({});
		const result = await askInitChoices(
			prompts,
			contextOf({ ...luau, packageManager: "wally" }, existing)
		);
		return { prompts, result: result.unwrap() };
	};

	it("should start a new tree without a hand-written project file", async () => {
		const { result } = await askBeside(["lobby.project.json"]);

		expect(result?.tree).toEqual({ kind: "new" });
	});

	it("should lift the project file a write would replace, without asking", async () => {
		const { prompts, result } = await askBeside([
			"default.project.json",
			"lobby.project.json",
		]);

		expect(prompts.asked).not.toContain("Project file");
		expect(result?.tree).toMatchObject({
			kind: "lift",
			from: "default.project.json",
		});
		expect(result?.mounts).toEqual([
			{
				path: "Packages",
				optional: true,
				landing: "ReplicatedStorage/Packages",
			},
			{
				path: "ServerPackages",
				optional: true,
				landing: "ServerScriptService/ServerPackages",
			},
		]);
	});

	it("should answer nothing when the user cancels", async () => {
		const result = await ask(luau, [CANCEL], ["default.project.json"]);

		expect(result.unwrap()).toBeUndefined();
	});
});

describe("InitQuestions addAgentInstructions", () => {
	it("should add them on Enter, as a run that can't ask does", async () => {
		const asked = new InitQuestions(new MockPromptService({}), true);
		const unasked = new InitQuestions(
			new MockPromptService([], false),
			false
		);

		expect(await asked.addAgentInstructions("AGENTS.md")).toBe(true);
		expect(await unasked.addAgentInstructions("AGENTS.md")).toBe(true);
	});
});

describe("InitQuestions addAgentHook", () => {
	it("should leave it out on Enter in a terminal, as in a run that can't ask", async () => {
		const asked = new InitQuestions(new MockPromptService({}), true);
		const unasked = new InitQuestions(
			new MockPromptService([], false),
			false
		);

		expect(await asked.addAgentHook(["Claude Code"])).toBe(false);
		expect(await unasked.addAgentHook(["Claude Code"])).toBe(false);
	});
});
