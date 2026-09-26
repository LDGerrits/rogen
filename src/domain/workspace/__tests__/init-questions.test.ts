import path from "path";
import { ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import {
	ACCEPT_DEFAULT,
	CANCEL,
	MockPromptService,
	ScriptedAnswer,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { DetectedWorkspace } from "../detect-workspace.js";
import { defaultInitChoices } from "../init-plan.js";
import { askInitChoices } from "../init-questions.js";

const directory = path.resolve("/mock/my-game");

const luau: DetectedWorkspace = {
	language: "luau",
	darklua: false,
	packageDirs: new Set(),
	rbxtsScopes: [],
	hasInclude: false,
};
const rbxts: DetectedWorkspace = {
	...luau,
	language: "roblox-ts",
	outDir: "build",
	rbxtsScopes: ["@rbxts"],
	hasInclude: true,
	packageManager: "wally",
	packageDirs: new Set(["Packages"]),
};

const contextOf = (
	workspace: DetectedWorkspace,
	existing: readonly string[] = []
) => ({ workspace, directory, existingFiles: new Set(existing) });

const ask = (
	workspace: DetectedWorkspace,
	answers: readonly ScriptedAnswer[],
	name?: string,
	existing: readonly string[] = []
) =>
	askInitChoices(
		new MockPromptService(answers),
		contextOf(workspace, existing),
		name
	);

const asked = async (...args: Parameters<typeof ask>) => {
	const choices = (await ask(...args)).unwrap();
	if (!choices) throw new Error("The questions were cancelled.");
	return choices;
};

const conflictsOf = (result: Awaited<ReturnType<typeof ask>>) =>
	(result as ResultError<Diagnostic[]>).error;

const acceptAll = (count: number) => Array(count).fill(ACCEPT_DEFAULT);

describe("askInitChoices", () => {
	it("should give the non-interactive choices when every default is accepted", async () => {
		expect(await asked(rbxts, acceptAll(5))).toEqual(
			defaultInitChoices(rbxts, "default")
		);
		expect(await asked(luau, acceptAll(4))).toEqual(
			defaultInitChoices(luau, "default")
		);
		const darklua = { ...luau, darklua: true };
		expect(await asked(darklua, acceptAll(5))).toEqual(
			defaultInitChoices(darklua, "default")
		);
	});

	it("should ask language, Darklua, root dirs and mounts in that order", async () => {
		const prompts = new MockPromptService(acceptAll(4));

		await askInitChoices(prompts, contextOf(luau), "lobby");

		expect(prompts.asked).toEqual([
			"Language",
			"Does Darklua process your code before Rojo syncs it?",
			"Root dirs",
			"Template mounts",
		]);
	});

	describe("config name", () => {
		it("should not ask for a name when default.rogen.json does not exist", async () => {
			const prompts = new MockPromptService(acceptAll(4));

			const result = await askInitChoices(prompts, contextOf(luau));

			expect(result.unwrap()?.name).toBe("default");
			expect(prompts.asked).not.toContain("Config name");
		});

		it("should not ask for a name that was given", async () => {
			const prompts = new MockPromptService(acceptAll(4));

			const result = await askInitChoices(
				prompts,
				contextOf(luau, ["default.rogen.json"]),
				"lobby"
			);

			expect(result.unwrap()?.name).toBe("lobby");
			expect(prompts.asked).not.toContain("Config name");
		});

		it("should ask for a name, without a placeholder, when default.rogen.json exists", async () => {
			const prompts = new MockPromptService(["test", ...acceptAll(4)]);

			const result = await askInitChoices(
				prompts,
				contextOf(luau, ["default.rogen.json"])
			);

			expect(result.unwrap()?.name).toBe("test");
			expect(prompts.prompts[0]).toMatchObject({
				message: "Config name",
				placeholder: undefined,
			});
			expect(prompts.prompts[0].description).toContain(
				"default.rogen.json already exists"
			);
		});

		it.each([
			["", "Enter a name."],
			["a/b", "path separators"],
			["default", "default.rogen.json already exists."],
			["lobby", "lobby.rogen.json already exists."],
		])("should reject the name %j at the prompt", async (name, message) => {
			await expect(
				ask(luau, [name], undefined, [
					"default.rogen.json",
					"lobby.rogen.json",
				])
			).rejects.toThrow(message);
		});

		it("should reject a name whose source config exists", async () => {
			await expect(
				ask(luau, ["lobby"], undefined, [
					"default.rogen.json",
					"lobby-source.rogen.json",
				])
			).rejects.toThrow("lobby-source.rogen.json already exists.");
		});
	});

	describe("language", () => {
		it("should preselect the detected language", async () => {
			expect((await asked(rbxts, acceptAll(5))).language).toBe(
				"roblox-ts"
			);
			expect((await asked(luau, acceptAll(4))).language).toBe("luau");
		});

		it("should take the language that was chosen", async () => {
			const choices = await asked(luau, ["roblox-ts", ...acceptAll(4)]);

			expect(choices.language).toBe("roblox-ts");
			expect(choices.syncDir).toBe("out");
		});
	});

	describe("darklua", () => {
		it("should be preselected when found", async () => {
			const choices = await asked(
				{ ...luau, darklua: true },
				acceptAll(5)
			);

			expect(choices.darklua).toBe(true);
			expect(choices.syncDir).toBe("dist");
		});

		it("should take the answer that was given", async () => {
			const choices = await asked(luau, [
				ACCEPT_DEFAULT,
				true,
				...acceptAll(3),
			]);

			expect(choices).toMatchObject({ darklua: true, syncDir: "dist" });
		});

		it("should fail before the remaining questions when a file it would write exists", async () => {
			const prompts = new MockPromptService([ACCEPT_DEFAULT, true]);

			const result = await askInitChoices(
				prompts,
				contextOf(luau, ["source.rogen.json"])
			);

			expect(conflictsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(directory, "source.rogen.json"),
				},
			]);
			expect(prompts.asked).toHaveLength(2);
		});
	});

	describe("sync dir", () => {
		const syncDirPrompt = (prompts: MockPromptService) =>
			prompts.prompts.find(({ message }) => message === "Sync dir");

		it("should be skipped for plain luau", async () => {
			const prompts = new MockPromptService(acceptAll(4));

			await askInitChoices(prompts, contextOf(luau));

			expect(syncDirPrompt(prompts)).toBeUndefined();
		});

		it("should default to the tsconfig outDir for roblox-ts", async () => {
			const prompts = new MockPromptService(acceptAll(5));

			await askInitChoices(prompts, contextOf(rbxts));

			expect(syncDirPrompt(prompts)?.placeholder).toBe("build");
			expect(syncDirPrompt(prompts)?.description).toContain(
				"roblox-ts compiles into"
			);
		});

		it("should default to dist for Darklua and say what Darklua does", async () => {
			const prompts = new MockPromptService(acceptAll(5));

			await askInitChoices(
				prompts,
				contextOf({ ...luau, darklua: true })
			);

			expect(syncDirPrompt(prompts)?.placeholder).toBe("dist");
			expect(syncDirPrompt(prompts)?.description).toContain(
				"Darklua writes into"
			);
		});
	});

	it("should split root dirs on commas", async () => {
		const choices = await asked(luau, [
			ACCEPT_DEFAULT,
			ACCEPT_DEFAULT,
			"src, shared ,,server",
			ACCEPT_DEFAULT,
		]);

		expect(choices.rootDirs).toEqual(["src", "shared", "server"]);
	});

	it("should mark mounts that are not installed as optional", async () => {
		const choices = await asked(rbxts, [
			ACCEPT_DEFAULT,
			ACCEPT_DEFAULT,
			ACCEPT_DEFAULT,
			ACCEPT_DEFAULT,
			[
				"node_modules/@rbxts",
				"node_modules/@flamework",
				"ServerPackages",
			],
		]);

		expect(choices.mounts).toEqual([
			{ path: "node_modules/@rbxts", optional: false },
			{ path: "node_modules/@flamework", optional: true },
			{ path: "ServerPackages", optional: true },
		]);
	});

	it("should offer the detected package manager's directories", async () => {
		const prompts = new MockPromptService(acceptAll(4));
		let offered: string[] = [];
		const original = prompts.multiSelect.bind(prompts);
		prompts.multiSelect = (options) => {
			offered = options.choices.map(({ value }) => value);
			return original(options);
		};

		await askInitChoices(
			prompts,
			contextOf({ ...luau, packageManager: "pesde" })
		);

		expect(offered).toEqual(
			expect.arrayContaining([
				"roblox_packages",
				"roblox_server_packages",
			])
		);
		expect(offered).not.toContain("Packages");
	});

	it("should show every text question as a placeholder with a description", async () => {
		const prompts = new MockPromptService(acceptAll(5));

		await askInitChoices(prompts, contextOf(rbxts));

		const text = prompts.prompts.filter(({ placeholder }) => placeholder);
		expect(text.map(({ message }) => message)).toEqual([
			"Root dirs",
			"Sync dir",
		]);
		expect(text.map(({ placeholder }) => placeholder)).toEqual([
			"src",
			"build",
		]);
		for (const { description } of text) expect(description).toBeTruthy();
	});

	it("should take the placeholder when a text answer is empty", async () => {
		const choices = await asked(luau, [
			ACCEPT_DEFAULT,
			ACCEPT_DEFAULT,
			"",
			ACCEPT_DEFAULT,
		]);

		expect(choices).toEqual(defaultInitChoices(luau, "default"));
	});

	it.each([0, 1, 2, 3])(
		"should resolve undefined when cancelled at question %i",
		async (index) => {
			const answers: ScriptedAnswer[] = acceptAll(index);
			answers.push(CANCEL);

			expect((await ask(rbxts, answers)).unwrap()).toBeUndefined();
		}
	);
});
