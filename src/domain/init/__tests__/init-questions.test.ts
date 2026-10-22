import { Result } from "../../../base/result.js";
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
import { InitChoices } from "../init-service.js";
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

const acceptAll = (count: number) => Array(count).fill(ACCEPT_DEFAULT);

describe("InitQuestions askProject", () => {
	it("should give an unattended run the choices a user accepting every default gets", async () => {
		const darklua = { ...luau, darkluaConfig: ".darklua.json" };
		for (const workspace of [
			rbxts,
			luau,
			darklua,
			{ ...luau, packageManager: "pesde" as const },
		]) {
			expect(await asked(workspace, {})).toEqual(
				await defaultInitChoices(workspace)
			);
		}
	});

	it("should ask in order: language, Darklua, source path, packages, routes, fallback", async () => {
		const prompts = new MockPromptService({});

		await askInitChoices(prompts, contextOf(rbxts));

		expect(prompts.asked).toEqual([
			"Language",
			"Does Darklua process your code before Rojo syncs it?",
			"Source path",
			"Packages",
			"Routes",
			"Files that match no route",
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

	describe("darklua", () => {
		it("should be preselected when found", async () => {
			const choices = await asked(
				{ ...luau, darkluaConfig: ".darklua.json" },
				{}
			);

			expect(choices.darklua).toBeInstanceOf(Darklua);
			expect(choices.compiledPath).toBe("dist");
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
			expect(choices.compiledPath).toBe("dist");
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

		it("should default to dist for Darklua and say what Darklua does", async () => {
			const prompts = new MockPromptService({});

			await askInitChoices(
				prompts,
				contextOf({ ...luau, darkluaConfig: ".darklua.json" })
			);

			expect(compiledPathPrompt(prompts)?.placeholder).toBe("dist");
			expect(compiledPathPrompt(prompts)?.description).toContain(
				"Darklua writes into"
			);
		});

		it.each(["src", "src/out", "./src/"])(
			"should refuse %j, which holds or lies in a source path",
			async (answer) => {
				await expect(
					ask(
						{ ...luau, darkluaConfig: ".darklua.json" },
						{
							"Does Darklua process your code before Rojo syncs it?": true,
							"Compiled path": answer,
						}
					)
				).rejects.toThrow("overlaps src");
			}
		);
	});

	it("should split source paths on commas", async () => {
		const choices = await asked(luau, {
			"Source paths": "src, ./shared/ ,,server",
		});

		expect(choices.sourcePaths).toEqual(["src", "shared", "server"]);
	});

	describe("source paths", () => {
		const sourcePathsPrompt = async (workspace: WorkspaceSpec) => {
			const prompts = new MockPromptService({});
			await askInitChoices(prompts, contextOf(workspace));
			return prompts.prompts.find(({ message }) =>
				message.startsWith("Source path")
			);
		};

		it("should take the placeholder from the tsconfig sourcePath for roblox-ts", async () => {
			const prompt = await sourcePathsPrompt({
				...withRobloxTs(rbxts, { sourcePath: "./game" }),
				hasSrc: true,
			});

			expect(prompt?.placeholder).toBe("game");
		});

		it("should ignore the tsconfig sourcePath for luau", async () => {
			const prompt = await sourcePathsPrompt({
				...withRobloxTs(luau, { sourcePath: "game" }),
				hasSrc: true,
			});

			expect(prompt?.placeholder).toBe("src");
		});

		it("should take src when it exists", async () => {
			const prompt = await sourcePathsPrompt({
				...luau,
				hasSrc: true,
				codeFolders: ["lib"],
			});

			expect(prompt?.placeholder).toBe("src");
		});

		it("should take the only code folder when src does not exist", async () => {
			const prompt = await sourcePathsPrompt({
				...luau,
				codeFolders: ["lib"],
			});

			expect(prompt?.placeholder).toBe("lib");
		});

		it("should fall back to src", async () => {
			expect((await sourcePathsPrompt(luau))?.placeholder).toBe("src");
			expect(
				(
					await sourcePathsPrompt({
						...luau,
						codeFolders: ["a", "b"],
					})
				)?.placeholder
			).toBe("src");
		});

		it("should not list the top folder of a nested source path as another", async () => {
			const prompt = await sourcePathsPrompt({
				...withRobloxTs(rbxts, { sourcePath: "src/main" }),
				codeFolders: ["lib", "src"],
			});

			expect(prompt?.placeholder).toBe("src/main");
			expect(prompt?.hint).toBe("Also found code in: lib");
		});

		it("should hint at the other code folders, never as a choice", async () => {
			const prompt = await sourcePathsPrompt({
				...luau,
				hasSrc: true,
				codeFolders: ["lib", "shared", "src"],
			});

			expect(prompt?.hint).toBe("Also found code in: lib, shared");
		});

		it("should not hint when there are no other code folders", async () => {
			const prompt = await sourcePathsPrompt({
				...luau,
				hasSrc: true,
				codeFolders: ["src"],
			});

			expect(prompt?.hint).toBeUndefined();
		});

		it("should say what a source path is, per language", async () => {
			expect((await sourcePathsPrompt(luau))?.description).toBe(
				"Folders with your scripts, relative to here. Separate several with commas."
			);
			expect(await sourcePathsPrompt(rbxts)).toMatchObject({
				message: "Source path",
				description:
					"The folder roblox-ts compiles (sourcePath in tsconfig.json).",
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
			await expect(ask(luau, { "Source paths": answer })).rejects.toThrow(
				message
			);
		});

		it("should take one source path for roblox-ts", async () => {
			await expect(
				ask(rbxts, { "Source path": "src, lib" })
			).rejects.toThrow("roblox-ts compiles one folder.");
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

		describe("from a lifted project file", () => {
			const projectFile = JSON.stringify({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ServerScriptService: { Server: { $path: "src/server" } },
					ReplicatedStorage: { Shared: { $path: "src/shared" } },
				},
			});

			const askLifting = async (
				prompts: MockPromptService,
				{
					project = projectFile,
					files = [],
					choices = {},
				}: {
					project?: string;
					files?: readonly string[];
					choices?: InitChoices;
				} = {}
			) => {
				const fileSystem = new MemoryFileSystemService();
				await fileSystem.createDirectory(directory);
				await fileSystem.writeFile(
					path.join(directory, "default.project.json"),
					project
				);
				for (const file of files)
					await fileSystem.writeFile(path.join(directory, file), "");
				return new ProjectSetup(
					directoryOf({
						workspace: luau,
						existing: ["default.project.json"],
					}),
					new InitQuestions(prompts, prompts.isInteractive, choices),
					fileSystem
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

				await askLifting(prompts);

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
					label: "Server",
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
					await askLifting(new MockPromptService([], false))
				).unwrap();

				expect(result?.routes).toEqual([
					"mount:server",
					"mount:shared",
					"client",
				]);
				expect(result?.fallback).toBe(true);
			});

			it("should accept a standard route id for the derived route that replaced it", async () => {
				const result = (
					await askLifting(new MockPromptService([], false), {
						choices: { routes: ["server", "shared"] },
					})
				).unwrap();

				expect(result?.routes).toEqual([
					"mount:server",
					"mount:shared",
				]);
			});

			it("should not route a mount whose folder holds an init file", async () => {
				const result = (
					await askLifting(new MockPromptService([], false), {
						files: ["src/server/init.server.luau"],
					})
				).unwrap();

				expect(result?.routes).toEqual([
					"mount:shared",
					"server",
					"client",
				]);
				expect(result?.tree).toMatchObject({
					kind: "lift",
					project: expect.objectContaining({}),
				});
			});

			it("should ask about no routes and no mounts for a root that is no DataModel", async () => {
				const prompts = new MockPromptService({});
				let asked = 0;
				const original = prompts.multiSelect.bind(prompts);
				prompts.multiSelect = (options) => {
					asked++;
					return original(options);
				};

				const result = (
					await askLifting(prompts, {
						project: JSON.stringify({ tree: { $path: "src" } }),
					})
				).unwrap();

				expect(asked).toBe(0);
				expect(result?.routes).toEqual([]);
				expect(result?.mounts).toEqual([]);
			});

			it("should offer the standard routes when the file is not lifted", async () => {
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
			"Source path",
			"Compiled path",
		]);
		expect(text.map(({ placeholder }) => placeholder)).toEqual([
			"src",
			"dist",
		]);
		for (const { description } of text) expect(description).toBeTruthy();
	});

	it("should take the placeholder when a text answer is empty", async () => {
		const choices = await asked(luau, { "Source paths": "" });

		expect(choices).toEqual(await defaultInitChoices(luau));
	});

	it.each([0, 1, 2, 3, 4, 5])(
		"should resolve undefined when cancelled at question %i",
		async (index) => {
			const answers: ScriptedAnswer[] = acceptAll(index);
			answers.push(CANCEL);

			expect((await ask(rbxts, answers)).unwrap()).toBeUndefined();
		}
	);
});

describe("InitQuestions askProject project file", () => {
	const projectFilePrompt = async (existing: readonly string[]) => {
		const prompts = new MockPromptService({});
		let choices: { value: string; label: string }[] = [];
		let initial: string | undefined;
		const original = prompts.select.bind(prompts);
		prompts.select = ((options: Parameters<typeof original>[0]) => {
			if (options.message === "Project file") {
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
		const { prompts, result } = await projectFilePrompt([
			"lobby.project.json",
		]);

		expect(prompts.asked).not.toContain("Project file");
		expect(result?.tree).toEqual({ kind: "new" });
	});

	it("should offer to lift the project file a build would replace, and preselect it", async () => {
		const { choices, initial, prompts, result } = await projectFilePrompt([
			"default.project.json",
			"lobby.project.json",
		]);

		expect(choices.map(({ label }) => label)).toEqual([
			"Lift default.project.json into default.rogen.json",
			"Start a new tree",
		]);
		expect(initial).toBe("lift");
		expect(
			prompts.prompts.find(({ message }) => message === "Project file")
				?.description
		).toBe(
			"default.project.json exists, and Rogen replaces it on every build."
		);
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
		expect(prompts.asked).toContain("Packages");
	});

	it("should start a new tree when that is the answer", async () => {
		const prompts = new MockPromptService({ "Project file": "new" });

		const result = (
			await askInitChoices(
				prompts,
				contextOf(luau, ["default.project.json"])
			)
		).unwrap();

		expect(result?.tree).toEqual({ kind: "new" });
	});

	it("should answer nothing when the user cancels", async () => {
		const result = await ask(
			luau,
			[CANCEL, CANCEL, CANCEL],
			["default.project.json"]
		);

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
