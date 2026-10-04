import { Result, ResultError } from "../../../base/result.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import {
	ACCEPT_DEFAULT,
	CANCEL,
	MockPromptService,
	ScriptedAnswer,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import {
	WorkspaceSpec,
	withRobloxTs,
} from "../../toolchain/__tests__/workspaces.js";
import { InitQuestions } from "../init-questions.js";
import { ProjectChoices, ProjectSetup } from "../project-setup.js";
import path from "path";
import { DirectorySpec, directory, directoryOf } from "./init-fixtures.js";

type Context = Omit<DirectorySpec, "givenName">;

const askInitChoices = async (
	prompts: MockPromptService,
	context: Context,
	name?: string
): Promise<Result<ProjectChoices | undefined, Diagnostic[]>> => {
	const fileSystem = new MemoryFileSystemService();
	await fileSystem.createDirectory(directory);
	for (const file of context.existing ?? [])
		await fileSystem.writeFile(path.join(directory, file), "{}");
	const setup = new ProjectSetup(
		directoryOf({ ...context, givenName: name }),
		new InitQuestions(prompts),
		fileSystem
	);
	return setup.ask();
};

const defaultInitChoices = async (
	workspace: WorkspaceSpec,
	name = "default",
	existing: readonly string[] = []
) =>
	(
		await askInitChoices(
			new MockPromptService([], false),
			{ workspace, existing },
			name === "default" ? undefined : name
		)
	).unwrap();

const luau: WorkspaceSpec = {};
const rbxts: WorkspaceSpec = {
	language: "roblox-ts",
	robloxTs: {
		outDir: "build",
		rbxtsScopes: ["@rbxts"],
		hasInclude: true,
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

describe("InitQuestions askProject", () => {
	it("should give an unattended run the choices a user accepting every default gets", async () => {
		const darklua = { ...luau, usesDarklua: true };
		for (const workspace of [
			rbxts,
			luau,
			darklua,
			{ ...luau, packageManager: "pesde" as const },
			{ ...luau, places: ["lobby", "match"] },
		]) {
			expect(await asked(workspace, acceptAll(10))).toEqual(
				await defaultInitChoices(workspace)
			);
		}
	});

	it("should ask in order: language, Darklua, root dir, packages, routes, fallback", async () => {
		const prompts = new MockPromptService(acceptAll(7));

		await askInitChoices(prompts, contextOf(rbxts), "lobby");

		expect(prompts.asked).toEqual([
			"Language",
			"Does Darklua process your code before Rojo syncs it?",
			"Root dir",
			"Packages",
			"Routes",
			"Files that match no route",
		]);
	});

	describe("config name", () => {
		it("should not ask for a name when default.rogen.json does not exist", async () => {
			const prompts = new MockPromptService(acceptAll(9));

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
			expect(prompts.prompts[0].description).toBe(
				"Writes <name>.rogen.json."
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

		it("should reject a name whose synced config exists", async () => {
			await expect(
				ask(luau, ["lobby"], undefined, [
					"default.rogen.json",
					"lobby-sync.rogen.json",
				])
			).rejects.toThrow("lobby-sync.rogen.json already exists.");
		});
	});

	describe("language", () => {
		it("should preselect the detected language", async () => {
			expect((await asked(rbxts, acceptAll(9))).language.id).toBe(
				"roblox-ts"
			);
			expect((await asked(luau, acceptAll(9))).language.id).toBe("luau");
		});

		it("should take the language that was chosen", async () => {
			const choices = await asked(luau, [
				ACCEPT_DEFAULT,
				"roblox-ts",
				...acceptAll(6),
			]);

			expect(choices.language.id).toBe("roblox-ts");
			expect(choices.syncDir).toBe("out");
		});
	});

	describe("darklua", () => {
		it("should be preselected when found", async () => {
			const choices = await asked(
				{ ...luau, usesDarklua: true },
				acceptAll(9)
			);

			expect(choices.darklua).toBe(true);
			expect(choices.syncDir).toBe("dist");
		});

		it("should take the answer that was given", async () => {
			const choices = await asked(luau, [
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				true,
				...acceptAll(6),
			]);

			expect(choices).toMatchObject({
				darklua: true,
				syncDir: "dist",
			});
		});

		it("should fail before the remaining questions when a file it would write exists", async () => {
			const prompts = new MockPromptService([
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				true,
			]);

			const result = await askInitChoices(
				prompts,
				contextOf(luau, ["sync.rogen.json"])
			);

			expect(conflictsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(directory, "sync.rogen.json"),
				},
			]);
			expect(prompts.asked).toHaveLength(3);
		});
	});

	describe("sync dir", () => {
		const syncDirPrompt = (prompts: MockPromptService) =>
			prompts.prompts.find(({ message }) => message === "Sync dir");

		it("should be skipped for plain luau", async () => {
			const prompts = new MockPromptService(acceptAll(9));

			await askInitChoices(prompts, contextOf(luau));

			expect(syncDirPrompt(prompts)).toBeUndefined();
		});

		it("should not be asked for roblox-ts, which syncs from its outDir", async () => {
			const prompts = new MockPromptService(acceptAll(8));

			const result = await askInitChoices(prompts, contextOf(rbxts));

			expect(syncDirPrompt(prompts)).toBeUndefined();
			expect(result.unwrap()?.syncDir).toBe("build");
		});

		it("should default to dist for Darklua and say what Darklua does", async () => {
			const prompts = new MockPromptService(acceptAll(9));

			await askInitChoices(
				prompts,
				contextOf({ ...luau, usesDarklua: true })
			);

			expect(syncDirPrompt(prompts)?.placeholder).toBe("dist");
			expect(syncDirPrompt(prompts)?.description).toContain(
				"Darklua writes into"
			);
		});
	});

	it("should split root dirs on commas", async () => {
		const choices = await asked(luau, [
			...acceptAll(3),
			"src, ./shared/ ,,server",
			...acceptAll(4),
		]);

		expect(choices.rootDirs).toEqual(["src", "shared", "server"]);
	});

	describe("root dirs", () => {
		const rootDirsPrompt = async (workspace: WorkspaceSpec) => {
			const prompts = new MockPromptService(acceptAll(9));
			await askInitChoices(prompts, contextOf(workspace));
			return prompts.prompts.find(({ message }) =>
				message.startsWith("Root dir")
			);
		};

		it("should take the placeholder from the tsconfig rootDir for roblox-ts", async () => {
			const prompt = await rootDirsPrompt({
				...withRobloxTs(rbxts, { rootDir: "./game" }),
				hasSrc: true,
			});

			expect(prompt?.placeholder).toBe("game");
		});

		it("should ignore the tsconfig rootDir for luau", async () => {
			const prompt = await rootDirsPrompt({
				...withRobloxTs(luau, { rootDir: "game" }),
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
				...withRobloxTs(rbxts, { rootDir: "src/main" }),
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

		it("should say what a root dir is, per language", async () => {
			expect((await rootDirsPrompt(luau))?.description).toBe(
				"Folders with your scripts, relative to here. Separate several with commas."
			);
			expect(await rootDirsPrompt(rbxts)).toMatchObject({
				message: "Root dir",
				description:
					"The folder roblox-ts compiles (rootDir in tsconfig.json).",
			});
		});

		it.each([
			[
				"src, src/Combat",
				"src/Combat is inside src. List only one of them.",
			],
			["src, ./src/", "src is listed twice."],
			["/abs/src", "Use a path relative to here, not /abs/src."],
			["../lib", "../lib is outside this folder."],
		])("should reject %j at the prompt", async (answer, message) => {
			await expect(ask(luau, [...acceptAll(3), answer])).rejects.toThrow(
				message
			);
		});

		it("should take one root dir for roblox-ts", async () => {
			await expect(
				ask(rbxts, [...acceptAll(3), "src, lib"])
			).rejects.toThrow(
				"roblox-ts compiles one folder. For code per place, set up several places."
			);
		});
	});

	describe("packages", () => {
		const optionsFor = async (
			workspace: WorkspaceSpec,
			existing: readonly string[] = []
		) => {
			const prompts = new MockPromptService(acceptAll(9));
			let offered: { value: string; hint?: string }[] | undefined;
			let initial: readonly string[] | undefined;
			const original = prompts.multiSelect.bind(prompts);
			prompts.multiSelect = (options) => {
				if (options.message === "Packages") {
					offered = [...options.choices];
					initial = options.initialValues;
				}
				return original(options);
			};
			await askInitChoices(prompts, contextOf(workspace, existing));
			return { offered, initial, prompts };
		};

		it("should never offer include or an @ scope to luau", async () => {
			const { offered } = await optionsFor(
				withRobloxTs(luau, {
					hasInclude: true,
					rbxtsScopes: ["@rbxts", "@flamework"],
				})
			);

			expect(offered?.map(({ value }) => value)).toEqual([
				"Packages",
				"ServerPackages",
			]);
		});

		it("should tick the package folders when the manifest exists, installed or not", async () => {
			expect(
				(await optionsFor({ ...luau, packageManager: "wally" })).initial
			).toEqual(["Packages", "ServerPackages"]);
			expect((await optionsFor(luau)).initial).toEqual([]);
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
			const { offered, prompts } = await optionsFor(
				withRobloxTs(rbxts, {
					rbxtsScopes: ["@rbxts", "@flamework", "@rbxts-js"],
				})
			);

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
			const prompts = new MockPromptService(acceptAll(8));

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
			const prompts = new MockPromptService(acceptAll(9));

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
				{
					path: "include",
					optional: false,
					landing: "ReplicatedStorage/rbxts_include",
				},
				{
					path: "node_modules/@rbxts",
					optional: false,
					landing:
						"ReplicatedStorage/rbxts_include/node_modules/@rbxts",
				},
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
			{
				path: "include",
				optional: false,
				landing: "ReplicatedStorage/rbxts_include",
			},
			{
				path: "node_modules/@rbxts",
				optional: false,
				landing: "ReplicatedStorage/rbxts_include/node_modules/@rbxts",
			},
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

	describe("routes", () => {
		const routesPrompt = async (workspace: WorkspaceSpec) => {
			const prompts = new MockPromptService(acceptAll(9));
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
			expect(description).toBe(
				"Where code goes. A Server folder, a .server marker file or a Foo.server.luau suffix all send code to ServerScriptService."
			);
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
			expect(description).toContain(
				"A server folder, a .server marker file or a Foo.server.ts suffix"
			);
		});

		it("should take the ticked routes", async () => {
			const choices = await asked(luau, [
				...acceptAll(5),
				["server", "starterGui"],
				ACCEPT_DEFAULT,
			]);

			expect(choices.routes).toEqual(["server", "starterGui"]);
			expect(choices.fallback).toBe(true);
		});

		it("should let files that match no route be left out", async () => {
			const choices = await asked(luau, [...acceptAll(6), "leave"]);

			expect(choices.fallback).toBe(false);
		});

		it("should say what the fallback options do, per language", async () => {
			const prompts = new MockPromptService(acceptAll(9));
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
			const prompts = new MockPromptService([...acceptAll(5), []]);

			const result = await askInitChoices(prompts, contextOf(luau));

			expect(prompts.asked).not.toContain("Files that match no route");
			expect(result.unwrap()).toMatchObject({
				routes: [],
				fallback: true,
			});
		});
	});

	it("should show every text question as a placeholder with a description", async () => {
		const prompts = new MockPromptService(acceptAll(10));

		await askInitChoices(
			prompts,
			contextOf({ ...rbxts, usesDarklua: true })
		);

		const text = prompts.prompts.filter(({ placeholder }) => placeholder);
		expect(text.map(({ message }) => message)).toEqual([
			"Root dir",
			"Sync dir",
		]);
		expect(text.map(({ placeholder }) => placeholder)).toEqual([
			"src",
			"dist",
		]);
		for (const { description } of text) expect(description).toBeTruthy();
	});

	it("should take the placeholder when a text answer is empty", async () => {
		const choices = await asked(luau, [
			...acceptAll(3),
			"",
			...acceptAll(4),
		]);

		expect(choices).toEqual(await defaultInitChoices(luau));
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

describe("InitQuestions askProject layout", () => {
	const withPlaces: WorkspaceSpec = {
		...luau,
		hasSrc: true,
		places: ["lobby", "match"],
	};

	it("should ask first on a first run without a name", async () => {
		const prompts = new MockPromptService(acceptAll(9));

		await askInitChoices(prompts, contextOf(luau));

		expect(prompts.asked[0]).toBe("What are you setting up?");
	});

	it("should not ask when a name was given", async () => {
		const prompts = new MockPromptService(acceptAll(9));

		await askInitChoices(prompts, contextOf(luau), "lobby");

		expect(prompts.asked).not.toContain("What are you setting up?");
	});

	it("should start with one place when no places were found", async () => {
		const choices = await asked(luau, acceptAll(9));

		expect(choices.places).toEqual([]);
	});

	it("should start with several places, and name them, when places were found", async () => {
		const prompts = new MockPromptService(acceptAll(10));

		const choices = (
			await askInitChoices(prompts, contextOf(withPlaces))
		).unwrap();

		expect(choices?.places).toEqual(["lobby", "match"]);
		expect(prompts.asked.at(-1)).toBe("Places");
		expect(prompts.prompts.at(-1)).toMatchObject({
			placeholder: "lobby, match",
		});
		expect(prompts.prompts[0].hint).toBeUndefined();
	});

	it("should offer lobby when several places are chosen and none were found", async () => {
		const choices = await asked(luau, ["several", ...acceptAll(9)]);

		expect(choices.places).toEqual(["lobby"]);
	});

	it("should say that the root dirs are the shared code", async () => {
		const prompts = new MockPromptService(acceptAll(10));

		await askInitChoices(prompts, contextOf(withPlaces));

		expect(
			prompts.prompts.find(({ message }) => message === "Root dirs")
				?.description
		).toContain("every place shares");
	});

	it.each([
		["lobby, lobby", "lobby is listed twice."],
		["default", "default.rogen.json is written for default"],
		["arena", "arena.rogen.json already exists."],
	])("should reject the places %j at the prompt", async (answer, message) => {
		await expect(
			ask(luau, ["several", ...acceptAll(6), answer], undefined, [
				"arena.rogen.json",
			])
		).rejects.toThrow(message);
	});

	it("should reject a place folder inside the shared root dir", async () => {
		await expect(
			ask(luau, [
				"several",
				ACCEPT_DEFAULT,
				ACCEPT_DEFAULT,
				".",
				...acceptAll(3),
				"lobby",
			])
		).rejects.toThrow("places/lobby overlaps .");
	});
});

describe("InitQuestions askProject template", () => {
	const templatePrompt = async (existing: readonly string[]) => {
		const prompts = new MockPromptService(acceptAll(9));
		let choices: { value: string; label: string }[] = [];
		let initial: string | undefined;
		const original = prompts.select.bind(prompts);
		prompts.select = ((options: Parameters<typeof original>[0]) => {
			if (options.message === "Template") {
				choices = [...options.choices];
				initial = options.initialValue;
			}
			return original(options);
		}) as typeof prompts.select;
		const result = await askInitChoices(
			prompts,
			contextOf({ ...luau, packageManager: "wally" }, existing)
		);
		return { choices, initial, prompts, result: result.unwrap() };
	};

	it("should not be asked without a hand-written project file", async () => {
		const { prompts } = await templatePrompt(["other.rogen.json"]);

		expect(prompts.asked).not.toContain("Template");
	});

	it("should not be asked when template.project.json exists", async () => {
		const { prompts } = await templatePrompt([
			"template.project.json",
			"default.project.json",
		]);

		expect(prompts.asked).not.toContain("Template");
	});

	it("should offer to copy the project file a build would replace, and preselect it", async () => {
		const { choices, initial, prompts, result } = await templatePrompt([
			"default.project.json",
			"base.project.json",
			"lobby.project.json",
			"lobby.rogen.json",
		]);

		expect(choices.map(({ label }) => label)).toEqual([
			"Copy default.project.json to template.project.json",
			"Use base.project.json",
			"Start a new template.project.json",
		]);
		expect(initial).toBe("copy:default.project.json");
		expect(
			prompts.prompts.find(({ message }) => message === "Template")
				?.description
		).toBe(
			"default.project.json exists, and Rogen replaces it on every build."
		);
		expect(result?.template).toEqual({
			kind: "copy",
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
		expect(prompts.asked).toContain("Packages");
	});

	it("should not ask for packages when using a project file as it is", async () => {
		const prompts = new MockPromptService([
			...acceptAll(4),
			"use:base.project.json",
			...acceptAll(5),
		]);
		const result = (
			await askInitChoices(
				prompts,
				contextOf({ ...luau, packageManager: "wally" }, [
					"base.project.json",
				])
			)
		).unwrap();

		expect(result?.template).toEqual({
			kind: "use",
			file: "base.project.json",
		});
		expect(result?.mounts).toEqual([]);
		expect(prompts.asked).not.toContain("Packages");
	});

	it("should preselect a new template when no output would be replaced", async () => {
		const { initial, prompts } = await templatePrompt([
			"base.project.json",
		]);

		expect(initial).toBe("new");
		expect(prompts.asked).toContain("Packages");
	});
});
