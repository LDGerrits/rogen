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

	describe("--sync-path", () => {
		it("should take a folder of its own", async () => {
			const { asked } = await run(darklua, { syncPath: "out" });

			expect(asked.unwrap()?.syncPath).toBe("out");
		});

		it("should refuse one that overlaps a source path", async () => {
			const error = await refused(
				run(darklua, { sourcePaths: ["src"], syncPath: "src" })
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
		expect(
			await questions({ rojoPin: true }).addRojoPin("rokit.toml")
		).toBe(true);
	});

	it("should write down the default it took, with its flag", async () => {
		const asked = questions({});
		await asked.addAgentInstructions("A.md");
		await asked.addAgentHook(["x"]);
		await asked.addRojoPin("rokit.toml");

		expect(asked.decided).toEqual([
			{ question: "agentRules", value: true, flag: "--agent-rules" },
			{ question: "agentHook", value: false, flag: "--agent-hook" },
			{ question: "rojoPin", value: false, flag: "--rojo-pin" },
		]);
	});

	it("should start a nested project only when told to", async () => {
		const enclosing = { directory: "/mock", fileNames: ["rogen.json"] };

		expect(await questions({}).startNestedProject(enclosing)).toBe(false);
		expect(
			await questions({ nested: true }).startNestedProject(enclosing)
		).toBe(true);
	});

	it("should list a place by the flag, or by the glob when it can't ask", async () => {
		expect(
			await questions({ placeListing: "folder" }).placeListing(
				"places/*",
				"places/lobby"
			)
		).toBe("places/lobby");
		const asked = questions({});
		expect(await asked.placeListing("places/*", "places/lobby")).toBe(
			"places/*"
		);
		expect(asked.decided).toEqual([
			{
				question: "placeListing",
				value: "glob",
				flag: "--place-listing",
			},
		]);
	});
});

describe("--place-id", () => {
	const questions = (choices: InitChoices, interactive = false) =>
		new InitQuestions(
			new MockPromptService([], interactive),
			interactive,
			choices
		);

	it("should take the place IDs it is given, and ask nothing", async () => {
		const asked = questions({ placeIds: ["1818", "2020"] });

		expect(await asked.placeIds("lobby")).toEqual([1818, 2020]);
		expect(asked.decided).toEqual([]);
	});

	it("should keep a place ID once, however often it is given", async () => {
		expect(
			await questions({ placeIds: ["1818", "2020", "1818"] }).placeIds(
				"lobby"
			)
		).toEqual([1818, 2020]);
	});

	it("should take none for no place ID", async () => {
		const asked = questions({ placeIds: ["none"] });

		expect(await asked.placeIds("lobby")).toBe("none");
		expect(asked.decided).toEqual([]);
	});

	it("should write down that a run that can't ask took none", async () => {
		const asked = questions({});

		expect(await asked.placeIds("lobby")).toEqual([]);
		expect(asked.decided).toEqual([
			{ question: "placeIds", value: [], flag: "--place-id" },
		]);
	});

	it("should take none of its own without a terminal when the config lists place IDs, and write that down nowhere", async () => {
		const asked = questions({});

		expect(
			await asked.placeIds("lobby", "the place IDs 1 of rogen.json")
		).toEqual([]);
		expect(asked.decided).toEqual([]);
	});

	it.each([["abc"], ["0"], ["-4"], ["1.5"], ["1e3"]])(
		"should refuse %s as a place ID",
		async (value) => {
			const error = await refused(
				questions({ placeIds: [value] }).placeIds("lobby")
			);

			expect(error.message).toContain(`'${value}'`);
		}
	);

	it("should refuse none beside a place ID", async () => {
		const error = await refused(
			questions({ placeIds: ["none", "1"] }).placeIds("lobby")
		);

		expect(error.message).toContain("can't be combined");
	});
});
