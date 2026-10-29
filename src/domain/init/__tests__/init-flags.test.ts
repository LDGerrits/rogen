import path from "path";
import { UsageError } from "../../../base/errors.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { InitQuestions } from "../init-questions.js";
import { InitChoices } from "../init-service.js";
import { ProjectSetup } from "../project-setup.js";
import { SampleGame } from "../sample-game.js";
import { WorkspaceSpec, directory, directoryOf } from "./init-fixtures.js";

const luau: WorkspaceSpec = {};
const withPackages: WorkspaceSpec = {
	packageManager: "wally",
	packageDirs: ["Packages"],
};
const rbxts: WorkspaceSpec = { language: "roblox-ts" };

async function run(
	workspace: WorkspaceSpec,
	choices: InitChoices,
	interactive = false,
	existing: readonly string[] = []
) {
	const prompts = new MockPromptService([], interactive);
	const questions = new InitQuestions(prompts, interactive, choices);
	const fileSystem = new MemoryFileSystemService();
	await fileSystem.createDirectory(directory);
	for (const file of existing)
		await fileSystem.writeFile(path.join(directory, file), "{}");
	const setup = new ProjectSetup(
		directoryOf({ workspace, existing }),
		questions,
		fileSystem
	);
	const asked = await setup.ask();
	return { questions, prompts, asked };
}

const decidedFlags = (questions: InitQuestions) =>
	questions.decided.map(({ flag }) => flag);

const refused = async (promise: Promise<unknown>) => {
	const error = await promise.catch((caught: unknown) => caught);
	expect(error).toBeInstanceOf(UsageError);
	return error as UsageError;
};

describe("init choices given as flags", () => {
	describe("a run that can't ask", () => {
		it("should write down each choice it took, with the flag that changes it", async () => {
			const { questions } = await run(luau, {});

			expect(questions.decided).toEqual([
				{ question: "kind", value: "place", flag: "--kind" },
				{ question: "language", value: "luau", flag: "--language" },
				{ question: "places", value: false, flag: "--places" },
				{ question: "sample", value: true, flag: "--sample" },
				{ question: "skipGit", value: false, flag: "--skip-git" },
			]);
		});

		it("should write down nothing for a choice it was given", async () => {
			const { questions } = await run(luau, {
				kind: "place",
				skipGit: true,
				language: "luau",
				places: false,
				sample: true,
			});

			expect(questions.decided).toEqual([]);
		});
	});

	describe("a terminal", () => {
		it("should not ask what the flags answered, and write nothing down", async () => {
			const { questions, prompts, asked } = await run(
				withPackages,
				{
					language: "luau",
					places: false,
				},
				true
			);

			expect(prompts.asked).toEqual([]);
			expect(questions.decided).toEqual([]);
			expect(asked.unwrap()?.mounts.map(({ path }) => path)).toEqual([
				"Packages",
				"ServerPackages",
			]);
		});
	});

	describe("--sample", () => {
		const fileNames = async (choices: InitChoices) =>
			(await run(luau, choices)).asked
				.unwrap()
				?.templateFiles?.map(({ fileName }) => fileName);

		it("should write the Greeter sample and Rojo's game in an empty folder", async () => {
			const { asked } = await run(luau, {});

			expect(asked.unwrap()?.sample).toBe(true);
			expect(asked.unwrap()?.tree).toEqual({
				kind: "new",
				game: new SampleGame("place"),
			});
			expect(await fileNames({})).toEqual([
				".gitignore",
				"src/Greeter/Shared/Greeting.luau",
				"src/Greeter/Server/Greeter.server.luau",
				"src/Greeter/Client/Greeter.client.luau",
				"place/Lighting/init.meta.json",
				"place/SoundService/init.meta.json",
				"place/Workspace/Baseplate.model.json",
				"place/Workspace/init.meta.json",
				"README.md",
			]);
		});

		it("should write none with --no-sample, and say nothing about it", async () => {
			const { asked, questions } = await run(luau, { sample: false });

			expect(asked.unwrap()?.sample).toBe(false);
			expect(asked.unwrap()?.tree).toEqual({ kind: "new" });
			expect(await fileNames({ sample: false })).toEqual([".gitignore"]);
			expect(questions.decided.map(({ flag }) => flag)).not.toContain(
				"--sample"
			);
		});

		it("should write none in a folder with code, and take that for the default", async () => {
			const { asked, questions } = await run(
				{ ...luau, codeFolders: ["src"] },
				{}
			);

			expect(asked.unwrap()?.sample).toBe(false);
			expect(questions.decided.map(({ flag }) => flag)).not.toContain(
				"--sample"
			);
		});

		it("should write it in a new roblox-ts project, whose starter tool sets the folder up", async () => {
			const { asked } = await run(luau, { language: "roblox-ts" });

			expect(asked.unwrap()?.sample).toBe(true);
			expect(asked.unwrap()?.scaffold?.tool.command.file).toBe("npm");
		});

		it("should write none where roblox-ts is set up already", async () => {
			const { asked } = await run(rbxts, {});

			expect(asked.unwrap()?.sample).toBe(false);
			expect(asked.unwrap()?.scaffold).toBeUndefined();
		});

		it("should refuse --sample where it can't be written, saying why", async () => {
			expect(
				(
					await refused(
						run({ ...luau, codeFolders: ["lib"] }, { sample: true })
					)
				).message
			).toBe("--sample is for a folder with no code, and lib has some.");
			expect(
				(await refused(run(luau, { sample: true, kind: "model" })))
					.message
			).toBe("--sample is for a place, not for a model.");
			expect(
				(await refused(run(rbxts, { sample: true }))).message
			).toContain("--sample isn't written for roblox-ts here");
		});
	});

	describe("--language", () => {
		it("should take a language the workspace offers", async () => {
			const { asked } = await run(luau, { language: "roblox-ts" });

			expect(asked.unwrap()?.language.id).toBe("roblox-ts");
		});

		it("should refuse another, naming the languages with the closest first", async () => {
			const error = await refused(run(luau, { language: "lua" }));

			expect(error.reason).toBe("'lua' is not a language.");
			expect(error.hint).toBe(
				"The values of --language are luau and roblox-ts."
			);
		});
	});

	describe("beside a hand-written project file", () => {
		const beside = (choices: InitChoices) =>
			run(luau, choices, false, ["default.project.json"]);

		it("should lift it, and write down no choice for it", async () => {
			const { asked, questions } = await beside({});

			expect(asked.unwrap()?.tree).toMatchObject({
				kind: "lift",
				from: "default.project.json",
			});
			expect(decidedFlags(questions)).not.toContain("--project-file");
		});

		it("should refuse --places and --sample, saying to move the file away first", async () => {
			expect((await refused(beside({ places: true }))).message).toBe(
				"--places starts a new tree, and default.project.json is here, which init lifts. Move default.project.json away first, or leave --places out."
			);
			expect((await refused(beside({ sample: true }))).message).toBe(
				"--sample needs a new tree, and default.project.json is here, which init lifts. Move default.project.json away first, or leave --sample out."
			);
		});

		it.each(["model", "plugin"] as const)(
			"should refuse --kind %s when the file is a place's",
			async (kind) => {
				expect((await refused(beside({ kind }))).message).toBe(
					`--kind ${kind} starts a new ${kind}, and default.project.json is here, which init lifts as a place. Move default.project.json away first, or leave --kind out.`
				);
			}
		);
	});
});

describe("the yes or no questions", () => {
	const questions = (choices: InitChoices) =>
		new InitQuestions(new MockPromptService([], false), false, choices);

	it("should take the flag, either way, over the default", async () => {
		expect(
			await questions({ agentRules: false }).addAgentInstructions("A.md")
		).toBe(false);
		expect(await questions({ agentHook: true }).addAgentHook(["x"])).toBe(
			true
		);
	});

	it("should write down the default it took, with its flag", async () => {
		const asked = questions({});
		await asked.addAgentInstructions("A.md");
		await asked.addAgentHook(["x"]);

		expect(asked.decided).toEqual([
			{ question: "agentRules", value: true, flag: "--agent-rules" },
			{ question: "agentHook", value: false, flag: "--agent-hook" },
		]);
	});
});
