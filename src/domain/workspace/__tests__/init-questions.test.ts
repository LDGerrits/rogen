import {
	ACCEPT_DEFAULT,
	CANCEL,
	MockPromptService,
	ScriptedAnswer,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { DetectedWorkspace } from "../detect-workspace.js";
import { defaultInitChoices } from "../init-plan.js";
import { askInitChoices } from "../init-questions.js";

const luau: DetectedWorkspace = {
	toolchain: "luau",
	packageDirs: new Set(),
	rbxtsScopes: [],
	hasInclude: false,
};
const rbxts: DetectedWorkspace = {
	...luau,
	toolchain: "roblox-ts",
	outDir: "build",
	rbxtsScopes: ["@rbxts"],
	hasInclude: true,
	packageManager: "wally",
	packageDirs: new Set(["Packages"]),
};

const ask = (
	workspace: DetectedWorkspace,
	answers: readonly ScriptedAnswer[],
	name?: string
) => askInitChoices(new MockPromptService(answers), workspace, name);

const acceptAll = (count: number) => Array(count).fill(ACCEPT_DEFAULT);

describe("askInitChoices", () => {
	it("should give the non-interactive choices when every default is accepted", async () => {
		expect(await ask(rbxts, acceptAll(5))).toEqual(
			defaultInitChoices(rbxts, "default")
		);
		expect(await ask(luau, acceptAll(4))).toEqual(
			defaultInitChoices(luau, "default")
		);
	});

	it("should skip the name question when a name was given", async () => {
		const prompts = new MockPromptService(acceptAll(4));

		const choices = await askInitChoices(prompts, luau, "lobby");

		expect(choices?.name).toBe("lobby");
		expect(prompts.asked).not.toContain("Config name");
	});

	it("should skip the sync dir question for plain luau", async () => {
		const prompts = new MockPromptService(acceptAll(4));

		await askInitChoices(prompts, luau);

		expect(prompts.asked).not.toContain("Sync dir");
	});

	it("should take the sync dir default from the chosen toolchain", async () => {
		const choices = await ask(luau, [
			ACCEPT_DEFAULT,
			"darklua",
			ACCEPT_DEFAULT,
			ACCEPT_DEFAULT,
			ACCEPT_DEFAULT,
		]);

		expect(choices).toMatchObject({
			toolchain: "darklua",
			syncDir: "dist",
		});
	});

	it("should split root dirs on commas", async () => {
		const choices = await ask(luau, [
			ACCEPT_DEFAULT,
			ACCEPT_DEFAULT,
			"src, shared ,,server",
			ACCEPT_DEFAULT,
		]);

		expect(choices?.rootDirs).toEqual(["src", "shared", "server"]);
	});

	it("should mark mounts that are not installed as optional", async () => {
		const choices = await ask(rbxts, [
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

		expect(choices?.mounts).toEqual([
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

		await askInitChoices(prompts, {
			...luau,
			packageManager: "pesde",
		});

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

		await askInitChoices(prompts, rbxts);

		const text = prompts.prompts.filter(({ placeholder }) => placeholder);
		expect(text.map(({ message }) => message)).toEqual([
			"Config name",
			"Root dirs",
			"Sync dir",
		]);
		expect(text.map(({ placeholder }) => placeholder)).toEqual([
			"default",
			"src",
			"build",
		]);
		for (const { description } of text) expect(description).toBeTruthy();
	});

	it("should take the placeholder when a text answer is empty", async () => {
		const choices = await ask(luau, [
			"",
			ACCEPT_DEFAULT,
			"",
			ACCEPT_DEFAULT,
		]);

		expect(choices).toEqual(defaultInitChoices(luau, "default"));
	});

	it("should reject an invalid config name", async () => {
		await expect(ask(luau, ["a/b"])).rejects.toThrow("path separators");
	});

	it.each([0, 1, 2, 3])(
		"should resolve undefined when cancelled at question %i",
		async (index) => {
			const answers: ScriptedAnswer[] = acceptAll(index);
			answers.push(CANCEL);

			expect(await ask(rbxts, answers)).toBeUndefined();
		}
	);
});
