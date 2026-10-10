import { Result, ResultError } from "../../../base/result.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import {
	ACCEPT_DEFAULT,
	CANCEL,
	MockPromptService,
	PromptScript,
	ScriptedAnswer,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { withRobloxTs } from "../../toolchain/__tests__/workspaces.js";
import { Darklua } from "../../toolchain/toolchain.js";
import { InitQuestions } from "../init-questions.js";
import { ProjectChoices, ProjectSetup } from "../project-setup.js";
import path from "path";
import {
	DirectorySpec,
	WorkspaceSpec,
	directory,
	directoryOf,
	placeFoldersOf,
} from "./init-fixtures.js";

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
		new InitQuestions(prompts, prompts.isInteractive),
		fileSystem,
		placeFoldersOf(fileSystem)
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
		const darklua = { ...luau, darkluaConfig: ".darklua.json" };
		for (const workspace of [
			rbxts,
			luau,
			darklua,
			{ ...luau, packageManager: "pesde" as const },
			{ ...luau, places: ["lobby", "match"] },
		]) {
			expect(await asked(workspace, {})).toEqual(
				await defaultInitChoices(workspace)
			);
		}
	});

	it("should ask in order: language, Darklua, root dir, packages, routes, fallback", async () => {
		const prompts = new MockPromptService({});

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
			const prompts = new MockPromptService({});

			const result = await askInitChoices(prompts, contextOf(luau));

			expect(result.unwrap()?.name).toBe("default");
			expect(prompts.asked).not.toContain("Config name");
		});

		it("should not ask for a name that was given", async () => {
			const prompts = new MockPromptService({});

			const result = await askInitChoices(
				prompts,
				contextOf(luau, ["default.rogen.json"]),
				"lobby"
			);

			expect(result.unwrap()?.name).toBe("lobby");
			expect(prompts.asked).not.toContain("Config name");
		});

		it("should ask for a name, without a placeholder, when default.rogen.json exists", async () => {
			const prompts = new MockPromptService({ "Config name": "test" });

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
			const prompts = new MockPromptService({ "Config name": "  test " });

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
			expect((await asked(rbxts, {})).language.id).toBe("roblox-ts");
			expect((await asked(luau, {})).language.id).toBe("luau");
		});

		it("should take the language that was chosen", async () => {
			const choices = await asked(luau, { Language: "roblox-ts" });

			expect(choices.language.id).toBe("roblox-ts");
			expect(choices.syncDir).toBe("out");
		});
	});

	describe("modes", () => {
		const withJest: WorkspaceSpec = { ...luau, testRunner: "Jest" };
		const MESSAGE = "Add dev and prod modes?";

		it("should offer modes when a test runner is found, hinting which", async () => {
			const prompts = new MockPromptService({});

			const choices = (
				await askInitChoices(prompts, contextOf(withJest))
			).unwrap();

			const question = prompts.prompts.find(
				({ message }) => message === MESSAGE
			);
			expect(question?.hint).toBe("found Jest");
			expect(question?.description).toContain("**/*.spec.luau");
			expect(choices?.modes).toBe(true);
		});

		it("should name the spec files of the language", async () => {
			const prompts = new MockPromptService({});

			await askInitChoices(
				prompts,
				contextOf({ ...rbxts, testRunner: "Jest" })
			);

			expect(
				prompts.prompts.find(({ message }) => message === MESSAGE)
					?.description
			).toContain("**/*.spec.ts");
		});

		it("should take the answer that was given", async () => {
			const choices = await asked(withJest, { [MESSAGE]: false });

			expect(choices.modes).toBeUndefined();
		});

		it("should not ask when no test runner is found", async () => {
			const prompts = new MockPromptService({});

			const choices = (
				await askInitChoices(prompts, contextOf(luau))
			).unwrap();

			expect(
				prompts.prompts.some(({ message }) => message === MESSAGE)
			).toBe(false);
			expect(choices?.modes).toBeUndefined();
		});

		it("should add modes without a terminal when a test runner is found", async () => {
			expect((await defaultInitChoices(withJest))?.modes).toBe(true);
			expect((await defaultInitChoices(luau))?.modes).toBeUndefined();
		});
	});

	describe("darklua", () => {
		it("should be preselected when found", async () => {
			const choices = await asked(
				{ ...luau, darkluaConfig: ".darklua.json" },
				{}
			);

			expect(choices.darklua).toBeInstanceOf(Darklua);
			expect(choices.syncDir).toBe("dist");
		});

		it("should hint at the Darklua config that was found", async () => {
			const prompts = new MockPromptService({});

			await askInitChoices(
				prompts,
				contextOf({ ...luau, darkluaConfig: ".darklua.json5" })
			);

			expect(
				prompts.prompts.find(({ message }) =>
					message.startsWith("Does Darklua")
				)?.hint
			).toBe("found .darklua.json5");
		});

		it("should take the answer that was given", async () => {
			const choices = await asked(luau, {
				"Does Darklua process your code before Rojo syncs it?": true,
			});

			expect(choices.darklua).toBeInstanceOf(Darklua);
			expect(choices.syncDir).toBe("dist");
		});

		it("should fail before the remaining questions when a file it would write exists", async () => {
			const prompts = new MockPromptService({
				"Does Darklua process your code before Rojo syncs it?": true,
			});

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
			const prompts = new MockPromptService({});

			await askInitChoices(prompts, contextOf(luau));

			expect(syncDirPrompt(prompts)).toBeUndefined();
		});

		it("should not be asked for roblox-ts, which syncs from its outDir", async () => {
			const prompts = new MockPromptService({});

			const result = await askInitChoices(prompts, contextOf(rbxts));

			expect(syncDirPrompt(prompts)).toBeUndefined();
			expect(result.unwrap()?.syncDir).toBe("build");
		});

		it("should default to dist for Darklua and say what Darklua does", async () => {
			const prompts = new MockPromptService({});

			await askInitChoices(
				prompts,
				contextOf({ ...luau, darkluaConfig: ".darklua.json" })
			);

			expect(syncDirPrompt(prompts)?.placeholder).toBe("dist");
			expect(syncDirPrompt(prompts)?.description).toContain(
				"Darklua writes into"
			);
		});
	});

	it("should split root dirs on commas", async () => {
		const choices = await asked(luau, {
			"Root dirs": "src, ./shared/ ,,server",
		});

		expect(choices.rootDirs).toEqual(["src", "shared", "server"]);
	});

	describe("root dirs", () => {
		const rootDirsPrompt = async (workspace: WorkspaceSpec) => {
			const prompts = new MockPromptService({});
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
			await expect(ask(luau, { "Root dirs": answer })).rejects.toThrow(
				message
			);
		});

		it("should take one root dir for roblox-ts", async () => {
			await expect(
				ask(rbxts, { "Root dir": "src, lib" })
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
			const prompts = new MockPromptService({});
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
				withRobloxTs(
					{ ...luau, packageManager: "wally" },
					{
						includeInstalled: true,
						rbxtsScopes: ["@rbxts", "@flamework"],
					}
				)
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
		});

		it("should skip the question when there is no package manager and no package folder", async () => {
			const { offered, prompts } = await optionsFor(luau);

			expect(offered).toBeUndefined();
			expect(prompts.asked).not.toContain("Packages");
		});

		it("should ask when a package folder exists without a manifest", async () => {
			const { offered } = await optionsFor({
				...luau,
				packageDirs: new Set(["Packages"]),
			});

			expect(offered?.map(({ value }) => value)).toContain("Packages");
		});

		it("should ask when a manifest exists and no folder does yet", async () => {
			const { offered } = await optionsFor({
				...luau,
				packageManager: "wally",
			});

			expect(offered?.map(({ value }) => value)).toContain("Packages");
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
			const prompts = new MockPromptService({});

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
			const prompts = new MockPromptService({});

			await askInitChoices(
				prompts,
				contextOf(luau, ["template.project.json"])
			);

			expect(prompts.asked).not.toContain("Packages");
		});

		it("should always mount include and @rbxts for roblox-ts", async () => {
			const choices = await asked(rbxts, { Packages: [] });

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
		const choices = await asked(rbxts, {
			Packages: ["Packages", "ServerPackages"],
		});

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
			const prompts = new MockPromptService({});
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
				"Where code goes. A Server folder, an @server marker file or a Foo@server.luau suffix all send code to ServerScriptService."
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
				"A server folder, an @server marker file or a Foo@server.ts suffix"
			);
		});

		describe("from a copied project file", () => {
			const projectFile = JSON.stringify({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ServerScriptService: { Server: { $path: "src/server" } },
					ReplicatedStorage: { Shared: { $path: "src/shared" } },
				},
			});

			const askCopying = async (prompts: MockPromptService) => {
				const fileSystem = new MemoryFileSystemService();
				await fileSystem.createDirectory(directory);
				await fileSystem.writeFile(
					path.join(directory, "default.project.json"),
					projectFile
				);
				return new ProjectSetup(
					directoryOf({
						workspace: luau,
						existing: ["default.project.json"],
					}),
					new InitQuestions(prompts, prompts.isInteractive),
					fileSystem,
					placeFoldersOf(fileSystem)
				).ask();
			};

			it("should offer the routes it derives first, ticked, beside the standard ones", async () => {
				const prompts = new MockPromptService({});
				let choices: { value: string; label: string; hint?: string }[] =
					[];
				let initial: readonly string[] | undefined;
				const original = prompts.multiSelect.bind(prompts);
				prompts.multiSelect = (options) => {
					if (options.message === "Routes") {
						choices = [...options.choices];
						initial = options.initialValues;
					}
					return original(options);
				};

				await askCopying(prompts);

				expect(choices.map(({ value }) => value)).toEqual([
					"mount:server",
					"mount:shared",
					"client",
					"replicatedFirst",
					"serverStorage",
					"starterGui",
				]);
				expect(choices[0]).toEqual({
					value: "mount:server",
					label: "server",
					hint: "→ ServerScriptService/Server · from default.project.json",
				});
				expect(initial).toEqual([
					"mount:server",
					"mount:shared",
					"client",
				]);
			});

			it("should take them without asking", async () => {
				const result = (
					await askCopying(new MockPromptService([], false))
				).unwrap();

				expect(result?.routes).toEqual([
					"mount:server",
					"mount:shared",
					"client",
				]);
				expect(result?.fallback).toBe(true);
			});

			it("should offer the standard routes when the file is not copied", async () => {
				const result = await defaultInitChoices(luau);

				expect(result?.routes).toEqual(["server", "client", "shared"]);
			});
		});

		it("should take the ticked routes", async () => {
			const choices = await asked(luau, {
				Routes: ["server", "starterGui"],
			});

			expect(choices.routes).toEqual(["server", "starterGui"]);
			expect(choices.fallback).toBe(true);
		});

		it("should let files that match no route be left out", async () => {
			const choices = await asked(luau, {
				"Files that match no route": "leave",
			});

			expect(choices.fallback).toBe(false);
		});

		it("should say what the fallback options do, per language", async () => {
			const prompts = new MockPromptService({});
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
			const prompts = new MockPromptService({ Routes: [] });

			const result = await askInitChoices(prompts, contextOf(luau));

			expect(prompts.asked).not.toContain("Files that match no route");
			expect(result.unwrap()).toMatchObject({
				routes: [],
				fallback: true,
			});
		});
	});

	it("should show every text question as a placeholder with a description", async () => {
		const prompts = new MockPromptService({});

		await askInitChoices(
			prompts,
			contextOf({ ...rbxts, darkluaConfig: ".darklua.json" })
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
		const choices = await asked(luau, { "Root dirs": "" });

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
		const prompts = new MockPromptService({});

		await askInitChoices(prompts, contextOf(luau));

		expect(prompts.asked[0]).toBe("What are you setting up?");
	});

	it("should not ask when a name was given", async () => {
		const prompts = new MockPromptService({});

		await askInitChoices(prompts, contextOf(luau), "lobby");

		expect(prompts.asked).not.toContain("What are you setting up?");
	});

	it("should start with one place when no places were found", async () => {
		const choices = await asked(luau, {});

		expect(choices.places).toEqual([]);
	});

	it("should start with several places, and name them, when places were found", async () => {
		const prompts = new MockPromptService({});

		const choices = (
			await askInitChoices(prompts, contextOf(withPlaces))
		).unwrap();

		expect(choices?.places.map(({ name }) => name)).toEqual([
			"lobby",
			"match",
		]);
		expect(prompts.asked.at(-1)).toBe("Places");
		expect(prompts.prompts.at(-1)).toMatchObject({
			placeholder: "lobby, match",
		});
		expect(prompts.prompts[0].hint).toBeUndefined();
	});

	it("should offer lobby when several places are chosen and none were found", async () => {
		const choices = await asked(luau, {
			"What are you setting up?": "several",
		});

		expect(choices.places.map(({ name }) => name)).toEqual(["lobby"]);
	});

	it("should ask where the shared code goes instead of the root dirs", async () => {
		const prompts = new MockPromptService({});

		await askInitChoices(prompts, contextOf(withPlaces));

		expect(prompts.asked).not.toContain("Root dirs");
		expect(
			prompts.prompts.find(({ message }) => message === "Shared code")
				?.description
		).toContain("every place shares");
	});

	it.each([
		["lobby, lobby", "lobby is listed twice."],
		["default", "default.rogen.json is written for default"],
		["arena", "arena.rogen.json already exists."],
	])("should reject the places %j at the prompt", async (answer, message) => {
		await expect(
			ask(
				luau,
				{ "What are you setting up?": "several", Places: answer },
				undefined,
				["arena.rogen.json"]
			)
		).rejects.toThrow(message);
	});

	it("should reject a place whose folder holds the shared code", async () => {
		await expect(
			ask(luau, {
				"What are you setting up?": "several",
				Places: "shared",
			})
		).rejects.toThrow("places/shared overlaps places/shared/src");
	});

	describe("shared code", () => {
		const sharedOf = async (
			workspace: WorkspaceSpec,
			answer: ScriptedAnswer = ACCEPT_DEFAULT
		) => {
			const { rootDirs, templateDir } = await asked(workspace, {
				"What are you setting up?": "several",
				"Shared code": answer,
			});
			return { rootDirs, templateDir };
		};

		it("should put it beside the places, with its template, when there is no code yet", async () => {
			expect(await sharedOf(luau)).toEqual({
				rootDirs: ["places/shared/src"],
				templateDir: "places/shared",
			});
		});

		it("should keep it in src when src already holds code", async () => {
			expect(await sharedOf({ ...luau, hasSrc: true })).toEqual({
				rootDirs: ["src"],
				templateDir: undefined,
			});
		});

		it("should keep it in the only folder that holds code", async () => {
			expect(await sharedOf({ ...luau, codeFolders: ["lib"] })).toEqual({
				rootDirs: ["lib"],
				templateDir: undefined,
			});
		});

		it("should keep it in the folder roblox-ts compiles", async () => {
			expect(
				(
					await sharedOf({
						...rbxts,
						robloxTs: { ...rbxts.robloxTs, rootDir: "game" },
					})
				).rootDirs
			).toEqual(["game"]);
		});

		it("should put it in a root folder when that is the answer", async () => {
			expect(await sharedOf(luau, "src")).toEqual({
				rootDirs: ["src"],
				templateDir: undefined,
			});
		});
	});
});

describe("InitQuestions askProject template", () => {
	const templatePrompt = async (existing: readonly string[]) => {
		const prompts = new MockPromptService({});
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
			content: "{}",
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
		const prompts = new MockPromptService({
			Template: "use:base.project.json",
		});
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
	it("should add it on Enter in a terminal, and never in a run that can't ask", async () => {
		const asked = new InitQuestions(new MockPromptService({}), true);
		const unasked = new InitQuestions(
			new MockPromptService([], false),
			false
		);

		expect(await asked.addAgentHook(["Claude Code"])).toBe(true);
		expect(await unasked.addAgentHook(["Claude Code"])).toBe(false);
	});
});

describe("InitQuestions whatToAdd", () => {
	const options = [
		{ id: "first", label: "First", hint: "the first", addition: 1 },
		{ id: "second", label: "Second", hint: "the second", addition: 2 },
	];

	it("should answer with the addition the user picks", async () => {
		const questions = new InitQuestions(
			new MockPromptService(["second"]),
			true
		);

		expect(await questions.whatToAdd(true, options)).toBe(2);
	});

	it("should preselect the first", async () => {
		const questions = new InitQuestions(
			new MockPromptService([ACCEPT_DEFAULT]),
			true
		);

		expect(await questions.whatToAdd(true, options)).toBe(1);
	});

	it("should take the first when it can't ask", async () => {
		const questions = new InitQuestions(new MockPromptService([]), false);

		expect(await questions.whatToAdd(false, options)).toBe(1);
	});

	it("should answer nothing when the user cancels", async () => {
		const questions = new InitQuestions(
			new MockPromptService([CANCEL]),
			true
		);

		expect(await questions.whatToAdd(true, options)).toBeUndefined();
	});
});
