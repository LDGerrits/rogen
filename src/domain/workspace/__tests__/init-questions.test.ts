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
	codeFolders: [],
	hasSrc: false,
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
		const darklua = { ...luau, darklua: true };
		for (const [workspace, count] of [
			[rbxts, 7],
			[luau, 6],
			[darklua, 7],
			[{ ...luau, packageManager: "pesde" }, 6],
		] as const) {
			expect(await asked(workspace, acceptAll(count))).toEqual(
				defaultInitChoices(workspace, "default")
			);
		}
	});

	it("should ask in order: language, Darklua, root dirs, sync dir, packages, routes, fallback", async () => {
		const prompts = new MockPromptService(acceptAll(7));

		await askInitChoices(prompts, contextOf(rbxts), "lobby");

		expect(prompts.asked).toEqual([
			"Language",
			"Does Darklua process your code before Rojo syncs it?",
			"Root dirs",
			"Sync dir",
			"Packages",
			"Routes",
			"Files that match no route",
		]);
	});

	describe("config name", () => {
		it("should not ask for a name when default.rogen.json does not exist", async () => {
			const prompts = new MockPromptService(acceptAll(6));

			const result = await askInitChoices(prompts, contextOf(luau));

			expect(result.unwrap()?.name).toBe("default");
			expect(prompts.asked).not.toContain("Config name");
		});

		it("should not ask for a name that was given", async () => {
			const prompts = new MockPromptService(acceptAll(6));

			const result = await askInitChoices(
				prompts,
				contextOf(luau, ["default.rogen.json"]),
				"lobby"
			);

			expect(result.unwrap()?.name).toBe("lobby");
			expect(prompts.asked).not.toContain("Config name");
		});

		it("should ask for a name, without a placeholder, when default.rogen.json exists", async () => {
			const prompts = new MockPromptService(["test", ...acceptAll(6)]);

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

		it("should trim the name that was typed", async () => {
			const prompts = new MockPromptService(["  test ", ...acceptAll(6)]);

			const result = await askInitChoices(
				prompts,
				contextOf(luau, ["default.rogen.json"])
			);

			expect(result.unwrap()?.name).toBe("test");
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
			expect((await asked(rbxts, acceptAll(7))).language).toBe(
				"roblox-ts"
			);
			expect((await asked(luau, acceptAll(6))).language).toBe("luau");
		});

		it("should take the language that was chosen", async () => {
			const choices = await asked(luau, ["roblox-ts", ...acceptAll(5)]);

			expect(choices.language).toBe("roblox-ts");
			expect(choices.syncDir).toBe("out");
		});
	});

	describe("darklua", () => {
		it("should be preselected when found", async () => {
			const choices = await asked(
				{ ...luau, darklua: true },
				acceptAll(7)
			);

			expect(choices.darklua).toBe(true);
			expect(choices.syncDir).toBe("dist");
		});

		it("should take the answer that was given", async () => {
			const choices = await asked(luau, [
				ACCEPT_DEFAULT,
				true,
				...acceptAll(5),
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
			const prompts = new MockPromptService(acceptAll(6));

			await askInitChoices(prompts, contextOf(luau));

			expect(syncDirPrompt(prompts)).toBeUndefined();
		});

		it("should default to the tsconfig outDir for roblox-ts", async () => {
			const prompts = new MockPromptService(acceptAll(7));

			await askInitChoices(prompts, contextOf(rbxts));

			expect(syncDirPrompt(prompts)?.placeholder).toBe("build");
			expect(syncDirPrompt(prompts)?.description).toContain(
				"roblox-ts compiles into"
			);
		});

		it("should default to dist for Darklua and say what Darklua does", async () => {
			const prompts = new MockPromptService(acceptAll(7));

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
			...acceptAll(3),
		]);

		expect(choices.rootDirs).toEqual(["src", "shared", "server"]);
	});

	describe("root dirs", () => {
		const rootDirsPrompt = async (workspace: DetectedWorkspace) => {
			const prompts = new MockPromptService(acceptAll(7));
			await askInitChoices(prompts, contextOf(workspace));
			return prompts.prompts.find(
				({ message }) => message === "Root dirs"
			);
		};

		it("should take the placeholder from the tsconfig rootDir for roblox-ts", async () => {
			const prompt = await rootDirsPrompt({
				...rbxts,
				rootDir: "./game",
				hasSrc: true,
			});

			expect(prompt?.placeholder).toBe("game");
		});

		it("should ignore the tsconfig rootDir for luau", async () => {
			const prompt = await rootDirsPrompt({
				...luau,
				rootDir: "game",
				hasSrc: true,
			});

			expect(prompt?.placeholder).toBe("src");
		});

		it("should take src when it exists", async () => {
			const prompt = await rootDirsPrompt({
				...luau,
				hasSrc: true,
				codeFolders: ["lib"],
			});

			expect(prompt?.placeholder).toBe("src");
		});

		it("should take the only code folder when src does not exist", async () => {
			const prompt = await rootDirsPrompt({
				...luau,
				codeFolders: ["lib"],
			});

			expect(prompt?.placeholder).toBe("lib");
		});

		it("should fall back to src", async () => {
			expect((await rootDirsPrompt(luau))?.placeholder).toBe("src");
			expect(
				(
					await rootDirsPrompt({
						...luau,
						codeFolders: ["a", "b"],
					})
				)?.placeholder
			).toBe("src");
		});

		it("should not list the top folder of a nested root dir as another", async () => {
			const prompt = await rootDirsPrompt({
				...rbxts,
				rootDir: "src/main",
				codeFolders: ["places", "src"],
			});

			expect(prompt?.placeholder).toBe("src/main");
			expect(prompt?.hint).toBe("Also found code in: places");
		});

		it("should hint at the other code folders, never as a choice", async () => {
			const prompt = await rootDirsPrompt({
				...luau,
				hasSrc: true,
				codeFolders: ["places", "shared", "src"],
			});

			expect(prompt?.hint).toBe("Also found code in: places, shared");
		});

		it("should not hint when there are no other code folders", async () => {
			const prompt = await rootDirsPrompt({
				...luau,
				hasSrc: true,
				codeFolders: ["src"],
			});

			expect(prompt?.hint).toBeUndefined();
		});

		it("should say that several are merged and the later one wins", async () => {
			const prompt = await rootDirsPrompt(luau);

			expect(prompt?.description).toContain("merged into one tree");
			expect(prompt?.description).toContain("later one wins");
		});
	});

	describe("packages", () => {
		const optionsFor = async (
			workspace: DetectedWorkspace,
			existing: readonly string[] = []
		) => {
			const prompts = new MockPromptService(acceptAll(7));
			let offered: { value: string; hint?: string }[] | undefined;
			const original = prompts.multiSelect.bind(prompts);
			prompts.multiSelect = (options) => {
				if (options.message === "Packages") {
					offered = [...options.choices];
				}
				return original(options);
			};
			await askInitChoices(prompts, contextOf(workspace, existing));
			return { offered, prompts };
		};

		it("should never offer include or an @ scope to luau", async () => {
			const { offered } = await optionsFor({
				...luau,
				hasInclude: true,
				rbxtsScopes: ["@rbxts", "@flamework"],
			});

			expect(offered?.map(({ value }) => value)).toEqual([
				"Packages",
				"ServerPackages",
			]);
		});

		it("should offer only pesde's folders when pesde is detected", async () => {
			const { offered } = await optionsFor({
				...luau,
				packageManager: "pesde",
			});

			expect(offered?.map(({ value }) => value)).toEqual([
				"roblox_packages",
				"roblox_server_packages",
			]);
		});

		it("should say where each option lands and whether it is installed", async () => {
			const { offered } = await optionsFor({
				...luau,
				packageManager: "wally",
				packageDirs: new Set(["Packages"]),
			});

			expect(offered).toEqual([
				expect.objectContaining({
					value: "Packages",
					hint: "→ ReplicatedStorage/Packages",
				}),
				expect.objectContaining({
					value: "ServerPackages",
					hint: "→ ServerScriptService/ServerPackages · not installed yet",
				}),
			]);
		});

		it("should offer the extra scopes roblox-ts found, and say include and @rbxts are always mounted", async () => {
			const { offered, prompts } = await optionsFor({
				...rbxts,
				rbxtsScopes: ["@rbxts", "@flamework", "@rbxts-js"],
			});

			expect(offered?.map(({ value }) => value)).toEqual([
				"Packages",
				"ServerPackages",
				"node_modules/@flamework",
				"node_modules/@rbxts-js",
			]);
			expect(offered?.[2].hint).toBe(
				"→ ReplicatedStorage/rbxts_include/node_modules/@flamework"
			);
			const prompt = prompts.prompts.find(
				({ message }) => message === "Packages"
			);
			expect(prompt?.description).toContain(
				"include and @rbxts are always mounted"
			);
		});

		it("should be skipped when nothing is offered", async () => {
			const prompts = new MockPromptService(acceptAll(6));

			const result = await askInitChoices(
				prompts,
				contextOf({ ...luau, language: "roblox-ts" })
			);

			expect(prompts.asked).not.toContain("Packages");
			expect(result.unwrap()?.mounts.map(({ path }) => path)).toEqual([
				"include",
				"node_modules/@rbxts",
			]);
		});

		it("should be skipped when template.project.json exists", async () => {
			const prompts = new MockPromptService(acceptAll(5));

			await askInitChoices(
				prompts,
				contextOf(luau, ["template.project.json"])
			);

			expect(prompts.asked).not.toContain("Packages");
		});

		it("should always mount include and @rbxts for roblox-ts", async () => {
			const choices = await asked(rbxts, [
				...acceptAll(4),
				[],
				...acceptAll(2),
			]);

			expect(choices.mounts).toEqual([
				{ path: "include", optional: false },
				{ path: "node_modules/@rbxts", optional: false },
			]);
		});
	});

	it("should mark packages that are not installed as optional", async () => {
		const choices = await asked(rbxts, [
			...acceptAll(4),
			["Packages", "ServerPackages"],
			...acceptAll(2),
		]);

		expect(choices.mounts).toEqual([
			{ path: "include", optional: false },
			{ path: "node_modules/@rbxts", optional: false },
			{ path: "Packages", optional: false },
			{ path: "ServerPackages", optional: true },
		]);
	});

	describe("routes", () => {
		const routesPrompt = async (workspace: DetectedWorkspace) => {
			const prompts = new MockPromptService(acceptAll(7));
			let choices: { value: string; label: string; hint?: string }[] = [];
			let initial: readonly string[] | undefined;
			const original = prompts.multiSelect.bind(prompts);
			prompts.multiSelect = (options) => {
				if (options.message === "Routes") {
					choices = [...options.choices];
					initial = options.initialValues;
				}
				return original(options);
			};
			await askInitChoices(prompts, contextOf(workspace));
			return {
				choices,
				initial,
				description: prompts.prompts.find(
					({ message }) => message === "Routes"
				)?.description,
			};
		};

		it("should offer the six routes with the standard three ticked", async () => {
			const { choices, initial } = await routesPrompt(luau);

			expect(choices.map(({ value }) => value)).toEqual([
				"server",
				"client",
				"shared",
				"replicatedFirst",
				"serverStorage",
				"starterGui",
			]);
			expect(initial).toEqual(["server", "client", "shared"]);
		});

		it("should label them with capitalised keys for luau and say where each goes", async () => {
			const { choices, description } = await routesPrompt(luau);

			expect(choices.map(({ label }) => label)).toEqual([
				"Server",
				"Client",
				"Shared",
				"ReplicatedFirst",
				"ServerStorage",
				"StarterGui",
			]);
			expect(choices[0].hint).toBe(
				"→ ServerScriptService · runs on the server"
			);
			expect(choices[2].hint).toContain("ReplicatedStorage/Shared");
			expect(description).toContain("A Server folder, a Server.luau");
		});

		it("should label them with lowercase keys for roblox-ts", async () => {
			const { choices, description } = await routesPrompt(rbxts);

			expect(choices.map(({ label }) => label).slice(0, 4)).toEqual([
				"server",
				"client",
				"shared",
				"replicatedFirst",
			]);
			expect(choices[2].hint).toContain("ReplicatedStorage/shared");
			expect(description).toContain("A server folder, a server.luau");
		});

		it("should take the ticked routes", async () => {
			const choices = await asked(luau, [
				...acceptAll(4),
				["server", "starterGui"],
				ACCEPT_DEFAULT,
			]);

			expect(choices.routes).toEqual(["server", "starterGui"]);
			expect(choices.fallback).toBe(true);
		});

		it("should let files that match no route be left out", async () => {
			const choices = await asked(luau, [...acceptAll(5), "leave"]);

			expect(choices.fallback).toBe(false);
		});

		it("should say what the fallback options do, per language", async () => {
			const prompts = new MockPromptService(acceptAll(7));
			let labels: string[] = [];
			const original = prompts.select.bind(prompts);
			prompts.select = ((options: Parameters<typeof original>[0]) => {
				if (options.message === "Files that match no route") {
					labels = options.choices.map(({ label }) => label);
				}
				return original(options);
			}) as typeof prompts.select;

			await askInitChoices(prompts, contextOf(rbxts));

			expect(labels).toEqual([
				"Put them in ReplicatedStorage/shared",
				"Leave them out (Rogen warns when it does)",
			]);
		});

		it("should skip the fallback question when no route is ticked", async () => {
			const prompts = new MockPromptService([...acceptAll(4), []]);

			const result = await askInitChoices(prompts, contextOf(luau));

			expect(prompts.asked).not.toContain("Files that match no route");
			expect(result.unwrap()).toMatchObject({
				routes: [],
				fallback: true,
			});
		});
	});

	it("should show every text question as a placeholder with a description", async () => {
		const prompts = new MockPromptService(acceptAll(7));

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
			...acceptAll(3),
		]);

		expect(choices).toEqual(defaultInitChoices(luau, "default"));
	});

	it.each([0, 1, 2, 3, 4, 5, 6])(
		"should resolve undefined when cancelled at question %i",
		async (index) => {
			const answers: ScriptedAnswer[] = acceptAll(index);
			answers.push(CANCEL);

			expect((await ask(rbxts, answers)).unwrap()).toBeUndefined();
		}
	);
});
