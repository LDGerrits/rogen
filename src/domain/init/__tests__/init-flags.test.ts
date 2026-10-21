import path from "path";
import { UsageError } from "../../../base/errors.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { InitQuestions } from "../init-questions.js";
import { InitChoices } from "../init-service.js";
import { ProjectSetup } from "../project-setup.js";
import { WorkspaceSpec, directory, directoryOf } from "./init-fixtures.js";

const luau: WorkspaceSpec = {};
const withPackages: WorkspaceSpec = {
	packageManager: "wally",
	packageDirs: ["Packages"],
};
const darklua: WorkspaceSpec = { darkluaConfig: ".darklua.json" };
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
				{ question: "darklua", value: false, flag: "--darklua" },
				{
					question: "sourcePaths",
					value: ["src"],
					flag: "--source-path",
				},
				{
					question: "routes",
					value: ["server", "client", "shared"],
					flag: "--route",
				},
				{ question: "unmatched", value: "shared", flag: "--unmatched" },
				{ question: "sample", value: true, flag: "--sample" },
				{ question: "skipGit", value: false, flag: "--skip-git" },
			]);
		});

		it("should write down the packages it mounted when it was offered some", async () => {
			const { questions } = await run(withPackages, {});

			expect(questions.decided).toContainEqual({
				question: "packages",
				value: ["Packages", "ServerPackages"],
				flag: "--package",
			});
		});

		it("should write down nothing for a choice it was given", async () => {
			const { questions } = await run(luau, {
				kind: "place",
				skipGit: true,
				language: "luau",
				darklua: false,
				sourcePaths: ["src"],
				routes: ["server"],
				unmatched: "leave",
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
					darklua: false,
					sourcePaths: ["lib"],
					packages: ["Packages"],
					routes: ["server", "shared"],
					unmatched: "leave",
				},
				true
			);

			expect(prompts.asked).toEqual([]);
			expect(questions.decided).toEqual([]);
			const choices = asked.unwrap();
			expect(choices?.sourcePaths).toEqual(["lib"]);
			expect(choices?.routes).toEqual(["server", "shared"]);
			expect(choices?.fallback).toBe(false);
			expect(choices?.mounts.map(({ path }) => path)).toEqual([
				"Packages",
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
			expect(asked.unwrap()?.tree).toEqual({ kind: "new", game: true });
			expect(await fileNames({})).toEqual([
				".gitignore",
				"src/Greeter/Shared/Greeting.luau",
				"src/Greeter/Server/Greeter.server.luau",
				"src/Greeter/Client/Greeter.client.luau",
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

		it("should write none when a route its folders are named after is left out", async () => {
			const { asked } = await run(luau, { routes: ["server", "shared"] });

			expect(asked.unwrap()?.sample).toBe(false);
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

	describe("--darklua", () => {
		it("should turn it on or off whatever was found", async () => {
			expect(
				(await run(darklua, { darklua: false })).asked.unwrap()?.darklua
			).toBeUndefined();
			expect(
				(await run(luau, { darklua: true })).asked.unwrap()?.darklua
			).toBeDefined();
		});
	});

	describe("--source-path", () => {
		it("should take several folders", async () => {
			const { asked } = await run(luau, { sourcePaths: ["a", "b/"] });

			expect(asked.unwrap()?.sourcePaths).toEqual(["a", "b"]);
		});

		it("should refuse a folder that overlaps another as the prompt would", async () => {
			const error = await refused(
				run(luau, { sourcePaths: ["a", "a/b"] })
			);

			expect(error.message).toContain("a");
		});

		it("should refuse several for a compiler that takes one", async () => {
			const error = await refused(
				run(
					{
						language: "roblox-ts",
						robloxTs: {
							outDir: "build",
							rbxtsScopes: ["@rbxts"],
							includeInstalled: true,
						},
					},
					{ sourcePaths: ["a", "b"] }
				)
			);

			expect(error.message).not.toBe("");
		});
	});

	describe("--compiled-path", () => {
		it("should take a folder of its own", async () => {
			const { asked } = await run(darklua, { compiledPath: "out" });

			expect(asked.unwrap()?.compiledPath).toBe("out");
		});

		it("should refuse one that overlaps a source path", async () => {
			const error = await refused(
				run(darklua, { sourcePaths: ["src"], compiledPath: "src" })
			);

			expect(error.message).toContain("overlaps src");
		});
	});

	describe("--package", () => {
		it("should mount the folders named, and none for none", async () => {
			const named = await run(withPackages, { packages: ["Packages"] });
			const none = await run(withPackages, { packages: ["none"] });

			expect(
				named.asked.unwrap()?.mounts.map(({ path }) => path)
			).toEqual(["Packages"]);
			expect(none.asked.unwrap()?.mounts).toEqual([]);
		});

		it("should take a folder written with a trailing slash", async () => {
			const { asked } = await run(withPackages, {
				packages: ["./Packages/"],
			});

			expect(asked.unwrap()?.mounts.map(({ path }) => path)).toEqual([
				"Packages",
			]);
		});

		it("should refuse none beside a folder", async () => {
			const error = await refused(
				run(withPackages, { packages: ["none", "Packages"] })
			);

			expect(error.reason).toBe(
				"'none' can't be combined with other values of --package."
			);
		});

		it("should say there is nothing to take when nothing is offered", async () => {
			const error = await refused(
				run(
					{
						language: "roblox-ts",
						robloxTs: {
							outDir: "build",
							rbxtsScopes: [],
							includeInstalled: true,
						},
					},
					{ packages: ["Packages"] }
				)
			);

			expect(error.hint).toBe(
				"There is nothing here for --package to take."
			);
		});

		it("should refuse a folder that isn't offered", async () => {
			const error = await refused(
				run(withPackages, { packages: ["Pakcages"] })
			);

			expect(error.hint).toBe(
				"The values of --package are Packages and ServerPackages."
			);
		});
	});

	describe("--route and --unmatched", () => {
		it("should take the routes named", async () => {
			const { asked } = await run(luau, { routes: ["client"] });

			expect(asked.unwrap()?.routes).toEqual(["client"]);
		});

		it("should take none, and then ask nothing about the files left", async () => {
			const { asked, questions } = await run(luau, { routes: ["none"] });

			expect(asked.unwrap()?.routes).toEqual([]);
			expect(decidedFlags(questions)).not.toContain("--unmatched");
		});

		it("should refuse --unmatched when there is no route for it to apply to", async () => {
			const error = await refused(
				run(luau, { routes: ["none"], unmatched: "leave" })
			);

			expect(error.reason).toBe("--unmatched has no route to apply to.");
		});

		it("should refuse a route that isn't offered, closest first", async () => {
			const error = await refused(run(luau, { routes: ["servr"] }));

			expect(error.hint).toMatch(/^The values of --route are server,/);
		});
	});

	describe("--project-file", () => {
		it("should refuse to lift a project file that isn't there", async () => {
			const error = await refused(run(luau, { projectFile: "lift" }));

			expect(error.message).toContain("nothing to lift");
		});

		it("should start a new tree instead of lifting the one there", async () => {
			const { asked } = await run(luau, { projectFile: "new" }, false, [
				"default.project.json",
			]);

			expect(asked.unwrap()?.tree.kind).toBe("new");
		});
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
		expect(await questions({ rojo: true }).rojo("rokit", "", [])).toBe(
			true
		);
		expect(await questions({ plugin: true }).studioPlugin()).toBe(true);
	});

	it("should write down the default it took, with its flag", async () => {
		const asked = questions({});
		await asked.addAgentInstructions("A.md");
		await asked.addAgentHook(["x"]);
		await asked.rojo("rokit", "", []);
		await asked.rojo(undefined, "", []);
		await asked.studioPlugin();

		expect(asked.decided).toEqual([
			{ question: "agentRules", value: true, flag: "--agent-rules" },
			{ question: "agentHook", value: false, flag: "--agent-hook" },
			{ question: "rojo", value: true, flag: "--rojo" },
			{ question: "rojo", value: "not installed", flag: "--rojo" },
			{ question: "plugin", value: false, flag: "--studio-plugin" },
		]);
	});

	it("should start a nested project only when told to", async () => {
		const enclosing = {
			directory: "/mock",
			fileNames: ["default.rogen.json"],
		};

		expect(await questions({}).startNestedProject(enclosing)).toBe(false);
		expect(
			await questions({ nested: true }).startNestedProject(enclosing)
		).toBe(true);
	});
});
