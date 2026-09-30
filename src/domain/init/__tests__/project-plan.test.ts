import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import path from "path";
import { ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { RogenConfig } from "../../config/config.js";
import { RojoTree } from "../../rojo/rojo-project.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { DetectedWorkspace } from "../../toolchain/toolchain.js";
import {
	robloxTsFacts,
	withRobloxTs,
} from "../../toolchain/__tests__/workspaces.js";
import {
	InitChoices,
	defaultInitChoices as defaultChoicesFor,
} from "../init-choices.js";
import { parseInitName } from "../init-files.js";
import { planProject } from "../project-plan.js";

const LUAU_ROUTES = {
	Server: "ServerScriptService",
	Client: "StarterPlayer/StarterPlayerScripts",
	Shared: "ReplicatedStorage/Shared",
	"*": "ReplicatedStorage/Shared",
};
const ROBLOX_TS_ROUTES = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	shared: "ReplicatedStorage/shared",
	"*": "ReplicatedStorage/shared",
};

const directory = path.resolve("/mock/my-game");

const luau: DetectedWorkspace = {
	language: "luau",
	darklua: false,
	codeFolders: [],
	hasSrc: false,
	packageDirs: new Set(),
	places: [],
	languageFacts: {},
};
const withPackages: Partial<DetectedWorkspace> = {
	packageManager: "wally",
	packageDirs: new Set(["Packages"]),
};
const mounts = {
	ReplicatedStorage: { Packages: { $path: "Packages" } },
	ServerScriptService: {
		ServerPackages: { $path: { optional: "ServerPackages" } },
	},
};

const toolchain = new CoreToolchainService(new MemoryFileSystemService());

const defaultInitChoices = (
	workspace: DetectedWorkspace,
	name: string,
	existingFiles: ReadonlySet<string>,
	withPlaces: boolean
) =>
	defaultChoicesFor(
		workspace,
		toolchain.getLanguage(workspace.language),
		name,
		existingFiles,
		withPlaces
	);

const planResult = (
	workspace: DetectedWorkspace,
	name = "default",
	existingFiles: readonly string[] = []
) =>
	planProject({
		choices: defaultInitChoices(workspace, name, new Set(), false),
		projectName: "my-game",
		directory,
		existingFiles: new Set(existingFiles),
	});

const plan = (...args: Parameters<typeof planResult>) =>
	planResult(...args).unwrap();

const errorsOf = (result: ReturnType<typeof planResult>) =>
	(result as ResultError<Diagnostic[]>).error;

const treeOf = (workspace: Partial<DetectedWorkspace>) => {
	const { template } = plan({ ...luau, ...workspace });
	return template && JSON.parse(template.content).tree;
};

const configOf = (
	files: ReturnType<typeof plan>,
	fileName: string
): RogenConfig => {
	const file = files.configs.find((config) => config.fileName === fileName);
	if (!file) throw new Error(`${fileName} was not planned`);
	return JSON.parse(file.content);
};

describe("planProject", () => {
	it("should write default.rogen.json for the default name", () => {
		const { configs } = plan(luau);

		expect(configs.map((config) => config.fileName)).toEqual([
			"default.rogen.json",
		]);
	});

	it("should write <name>.rogen.json for a named config", () => {
		const { configs } = plan(luau, "lobby");

		expect(configs.map((config) => config.fileName)).toEqual([
			"lobby.rogen.json",
		]);
	});

	it("should write the starting routes explicitly", () => {
		const config = configOf(plan(luau), "default.rogen.json");

		expect(config.routes).toEqual(LUAU_ROUTES);
	});

	it("should write fields in pipeline order", () => {
		const { configs } = plan(
			withRobloxTs(
				{ ...luau, ...withPackages, language: "roblox-ts" },
				{ outDir: "out" }
			),
			"default"
		);

		expect(Object.keys(JSON.parse(configs[0].content))).toEqual([
			"$schema",
			"rootDirs",
			"routes",
			"template",
			"syncDir",
		]);
	});

	it("should write strict JSON with a trailing newline", () => {
		const { configs } = plan(luau);

		expect(configs[0].content.endsWith("}\n")).toBe(true);
		expect(() => JSON.parse(configs[0].content)).not.toThrow();
	});

	it("should write neither sync dir nor template for plain luau", () => {
		const config = configOf(plan(luau), "default.rogen.json");

		expect(config.syncDir).toBeUndefined();
		expect(config.template).toBeUndefined();
		expect(config.extends).toBeUndefined();
	});

	it("should write the detected outDir as syncDir for roblox-ts", () => {
		const { configs } = plan(
			withRobloxTs(
				{ ...luau, language: "roblox-ts" },
				{ outDir: "build" }
			)
		);

		expect(configs).toHaveLength(1);
		expect(JSON.parse(configs[0].content).syncDir).toBe("build");
	});

	describe("darklua", () => {
		const darklua: DetectedWorkspace = { ...luau, darklua: true };

		it("should write a source config and a default config extending it", () => {
			const files = plan(darklua);

			expect(files.configs.map((config) => config.fileName)).toEqual([
				"source.rogen.json",
				"default.rogen.json",
			]);
			const source = configOf(files, "source.rogen.json");
			const child = configOf(files, "default.rogen.json");
			expect(source.syncDir).toBeUndefined();
			expect(source.routes).toEqual(LUAU_ROUTES);
			expect(child.extends).toBe("./source.rogen.json");
			expect(child.syncDir).toBe("dist");
		});

		it("should add only syncDir to the extending config", () => {
			const child = configOf(plan(darklua), "default.rogen.json");

			expect(Object.keys(child)).toEqual([
				"$schema",
				"extends",
				"syncDir",
			]);
		});

		it("should name the pair <name> and <name>-source for a named config", () => {
			const files = plan(darklua, "lobby");

			expect(files.configs.map((config) => config.fileName)).toEqual([
				"lobby-source.rogen.json",
				"lobby.rogen.json",
			]);
			expect(configOf(files, "lobby.rogen.json").extends).toBe(
				"./lobby-source.rogen.json"
			);
		});

		it("should put the template in the source config only", () => {
			const files = plan({ ...darklua, ...withPackages });

			expect(configOf(files, "source.rogen.json").template).toBe(
				"template.project.json"
			);
			expect(
				configOf(files, "default.rogen.json").template
			).toBeUndefined();
		});
	});

	describe("language and darklua", () => {
		const planFor = (
			language: DetectedWorkspace["language"],
			darklua: boolean,
			name = "default"
		) =>
			planProject({
				choices: defaultInitChoices(
					withRobloxTs(
						{ ...luau, language, darklua },
						{ outDir: "build" }
					),
					name,
					new Set(),
					false
				),
				projectName: "my-game",
				directory,
				existingFiles: new Set(),
			}).unwrap();

		it("should write one config without a sync dir for luau", () => {
			const files = planFor("luau", false);

			expect(files.configs.map((file) => file.fileName)).toEqual([
				"default.rogen.json",
			]);
			expect(
				configOf(files, "default.rogen.json").syncDir
			).toBeUndefined();
		});

		it("should write a source config and a dist config for luau with darklua", () => {
			const files = planFor("luau", true);

			expect(files.configs.map((file) => file.fileName)).toEqual([
				"source.rogen.json",
				"default.rogen.json",
			]);
			expect(
				configOf(files, "source.rogen.json").syncDir
			).toBeUndefined();
			expect(configOf(files, "default.rogen.json")).toMatchObject({
				extends: "./source.rogen.json",
				syncDir: "dist",
			});
		});

		it("should write one config with the outDir for roblox-ts", () => {
			const files = planFor("roblox-ts", false);

			expect(files.configs.map((file) => file.fileName)).toEqual([
				"default.rogen.json",
			]);
			expect(configOf(files, "default.rogen.json").syncDir).toBe("build");
		});

		it("should write one config synced from dist for roblox-ts with darklua", () => {
			const files = planFor("roblox-ts", true);

			expect(files.configs.map((file) => file.fileName)).toEqual([
				"default.rogen.json",
			]);
			expect(configOf(files, "default.rogen.json")).toMatchObject({
				syncDir: "dist",
			});
			expect(
				configOf(files, "default.rogen.json").extends
			).toBeUndefined();
		});

		it("should say how to run luau", () => {
			expect(planFor("luau", false).nextSteps).toEqual({
				setup: [],
				run: ["rogen watch", "rojo serve default.project.json"],
				darklua: [],
				edits: [
					'Add your own routes under "routes" in default.rogen.json.',
					'Add tags under "tags" in default.rogen.json to swap in variants like Analytics.mock.luau.',
				],
			});
		});

		it("should start rbxtsc first for roblox-ts", () => {
			expect(planFor("roblox-ts", false).nextSteps.run).toEqual([
				"rbxtsc -w",
				"rogen watch",
				"rojo serve default.project.json",
			]);
		});

		it("should say what Darklua must process", () => {
			expect(planFor("luau", true).nextSteps.darklua).toEqual([
				"darklua process src dist",
			]);
		});

		it("should watch the source config Darklua reads", () => {
			expect(planFor("luau", true).nextSteps.run).toContain(
				"rogen watch default source"
			);
			expect(planFor("luau", true, "lobby").nextSteps.run).toContain(
				"rogen watch lobby lobby-source"
			);
		});

		it("should give each root dir its own path under the sync dir", () => {
			const files = planProject({
				choices: {
					...defaultInitChoices(
						{ ...luau, darklua: true },
						"default",
						new Set(),
						false
					),
					rootDirs: ["src", "lib/shared"],
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(),
			}).unwrap();

			expect(files.nextSteps.darklua).toEqual([
				"darklua process src dist/src",
				"darklua process lib/shared dist/lib/shared",
			]);
		});

		it("should point the routes hint at the source config for luau with darklua", () => {
			expect(planFor("luau", true, "lobby").nextSteps.edits).toEqual([
				'Add your own routes under "routes" in lobby-source.rogen.json.',
				'Add tags under "tags" in lobby-source.rogen.json to swap in variants like Analytics.mock.luau.',
			]);
		});

		it("should mention tags with a .ts variant for roblox-ts", () => {
			expect(planFor("roblox-ts", false).nextSteps.edits.at(-1)).toBe(
				'Add tags under "tags" in default.rogen.json to swap in variants like Analytics.mock.ts.'
			);
		});

		it("should tell roblox-ts with darklua to process the compiled output", () => {
			expect(planFor("roblox-ts", true).nextSteps.darklua).toEqual([
				"darklua process build dist",
			]);
		});

		it("should carry the config name into the commands", () => {
			expect(planFor("luau", false, "lobby").nextSteps).toEqual({
				setup: [],
				run: ["rogen watch lobby", "rojo serve lobby.project.json"],
				darklua: [],
				edits: [
					'Add your own routes under "routes" in lobby.rogen.json.',
					'Add tags under "tags" in lobby.rogen.json to swap in variants like Analytics.mock.luau.',
				],
			});
		});
	});

	describe("routes", () => {
		const routesOf = (choices: Partial<InitChoices>, language = "luau") => {
			const workspace = {
				...luau,
				language,
			} as DetectedWorkspace;
			const files = planProject({
				choices: {
					...defaultInitChoices(
						workspace,
						"default",
						new Set(),
						false
					),
					...choices,
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(),
			}).unwrap();
			return configOf(files, "default.rogen.json").routes;
		};

		it("should write the standard routes with capitalised keys for luau", () => {
			expect(routesOf({})).toEqual(LUAU_ROUTES);
		});

		it("should write the standard routes with lowercase keys for roblox-ts", () => {
			expect(routesOf({}, "roblox-ts")).toEqual(ROBLOX_TS_ROUTES);
		});

		it("should write exactly the ticked routes in a fixed order", () => {
			expect(
				routesOf({
					routes: ["starterGui", "server", "replicatedFirst"],
				})
			).toEqual({
				Server: "ServerScriptService",
				ReplicatedFirst: "ReplicatedFirst",
				StarterGui: "StarterGui",
				"*": "ReplicatedStorage/Shared",
			});
		});

		it("should camel-case the optional routes for roblox-ts", () => {
			expect(
				routesOf(
					{
						routes: [
							"replicatedFirst",
							"serverStorage",
							"starterGui",
						],
					},
					"roblox-ts"
				)
			).toEqual({
				replicatedFirst: "ReplicatedFirst",
				serverStorage: "ServerStorage",
				starterGui: "StarterGui",
				"*": "ReplicatedStorage/shared",
			});
		});

		it("should omit * when files that match no route are left out", () => {
			expect(routesOf({ fallback: false })).toEqual({
				Server: "ServerScriptService",
				Client: "StarterPlayer/StarterPlayerScripts",
				Shared: "ReplicatedStorage/Shared",
			});
		});

		it("should write * when no route is ticked, because a config with no routes can't build", () => {
			expect(routesOf({ routes: [], fallback: false })).toEqual({
				"*": "ReplicatedStorage/Shared",
			});
		});
	});

	describe("template", () => {
		it("should write template.project.json when mounts were detected", () => {
			const files = plan({ ...luau, ...withPackages });

			expect(files.template?.fileName).toBe("template.project.json");
			expect(JSON.parse(files.template!.content)).toEqual({
				name: "my-game",
				tree: { $className: "DataModel", ...mounts },
			} satisfies RojoTree);
			expect(configOf(files, "default.rogen.json").template).toBe(
				"template.project.json"
			);
		});

		it("should not write a template when nothing was mounted", () => {
			const files = plan(luau);

			expect(files.template).toBeUndefined();
		});

		it("should reference an existing template without rewriting it", () => {
			const files = plan({ ...luau, ...withPackages }, "lobby", [
				"template.project.json",
			]);

			expect(files.template).toBeUndefined();
			expect(configOf(files, "lobby.rogen.json").template).toBe(
				"template.project.json"
			);
			expect(files.notes).toEqual(["Using template.project.json."]);
		});

		it("should warn that a hand-written output is replaced when a template exists", () => {
			const files = plan(luau, "default", [
				"template.project.json",
				"default.project.json",
			]);

			expect(files.notes).toEqual([
				"Using template.project.json.",
				"Rogen replaces default.project.json on every build; move anything you need from it into template.project.json first.",
			]);
		});

		const withTemplate = (
			template: InitChoices["template"],
			copiedTemplate?: string
		) =>
			planProject({
				choices: {
					...defaultInitChoices(luau, "default", new Set(), false),
					template,
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(["default.project.json"]),
				copiedTemplate,
			}).unwrap();

		it("should copy a hand-written project file to the template byte for byte", () => {
			const content = '{ "name": "mine", "tree": {} }\n';
			const files = withTemplate(
				{ kind: "copy", from: "default.project.json" },
				content
			);

			expect(files.template).toEqual({
				fileName: "template.project.json",
				content,
			});
			expect(configOf(files, "default.rogen.json").template).toBe(
				"template.project.json"
			);
			expect(files.notes).toEqual([
				"Copying default.project.json to template.project.json, since Rogen replaces default.project.json on every build.",
			]);
			expect(files.nextSteps.edits).not.toContainEqual(
				expect.stringContaining("Remove the nodes")
			);
		});

		it("should leave out of a copied template the nodes that point into the root dirs", () => {
			const files = withTemplate(
				{ kind: "copy", from: "default.project.json" },
				JSON.stringify({
					name: "my-game",
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Shared: { $path: "src/shared" },
							Packages: { $path: "Packages" },
						},
						ServerScriptService: {
							$className: "ServerScriptService",
							Server: { $path: { optional: "./src/server" } },
						},
						StarterPlayer: {
							StarterPlayerScripts: {
								Client: { $path: "src/client" },
							},
						},
						Workspace: {
							Map: {
								$path: "src",
								$properties: { Locked: true },
							},
						},
					},
				})
			);

			expect(JSON.parse(files.template?.content ?? "")).toEqual({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "Packages" } },
					ServerScriptService: {
						$className: "ServerScriptService",
					},
					StarterPlayer: { StarterPlayerScripts: {} },
					Workspace: {},
				},
			});
			expect(files.notes).toEqual([
				"Copying default.project.json to template.project.json, since Rogen replaces default.project.json on every build.",
				"Left out ReplicatedStorage/Shared, ServerScriptService/Server, StarterPlayer/StarterPlayerScripts/Client and Workspace/Map, since they point into src and Rogen generates that code now.",
			]);
			expect(files.nextSteps.edits).not.toContainEqual(
				expect.stringContaining("Remove the nodes")
			);
		});

		it("should leave out of a copied template the nodes that point into the sync dir", () => {
			const files = planProject({
				choices: {
					...defaultInitChoices(
						{ ...luau, language: "roblox-ts" },
						"default",
						new Set(),
						false
					),
					template: { kind: "copy", from: "default.project.json" },
					mounts: [],
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(["default.project.json"]),
				copiedTemplate: JSON.stringify({
					name: "my-game",
					tree: {
						$className: "DataModel",
						ServerScriptService: { TS: { $path: "out/server" } },
					},
				}),
			}).unwrap();

			expect(JSON.parse(files.template?.content ?? "").tree).toEqual({
				$className: "DataModel",
				ServerScriptService: {},
			});
			expect(files.notes[1]).toBe(
				"Left out ServerScriptService/TS, since it points into src or out and Rogen generates that code now."
			);
		});

		it("should leave out of a copied template the nodes that point into a place folder", () => {
			const files = planProject({
				choices: {
					...defaultInitChoices(luau, "default", new Set(), false),
					template: { kind: "copy", from: "default.project.json" },
					places: ["lobby"],
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(["default.project.json"]),
				copiedTemplate: JSON.stringify({
					name: "my-game",
					tree: {
						$className: "DataModel",
						ServerScriptService: {
							Lobby: { $path: "places/lobby/Server" },
						},
					},
				}),
			}).unwrap();

			expect(JSON.parse(files.template?.content ?? "").tree).toEqual({
				$className: "DataModel",
				ServerScriptService: {},
			});
		});

		it("should keep a $path that isn't a path", () => {
			const files = withTemplate(
				{ kind: "copy", from: "default.project.json" },
				JSON.stringify({
					name: "my-game",
					tree: { Odd: { $path: 5 }, Empty: { $path: {} } },
				})
			);

			expect(JSON.parse(files.template?.content ?? "").tree).toEqual({
				Odd: { $path: 5 },
				Empty: { $path: {} },
			});
		});

		it("should copy a template as it is when a root dir is the whole folder, and say what to remove", () => {
			const content = JSON.stringify({
				name: "my-game",
				tree: { Shared: { $path: "shared" } },
			});
			const files = planProject({
				choices: {
					...defaultInitChoices(luau, "default", new Set(), false),
					template: { kind: "copy", from: "default.project.json" },
					rootDirs: ["."],
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(["default.project.json"]),
				copiedTemplate: content,
			}).unwrap();

			expect(files.template?.content).toBe(content);
			expect(files.nextSteps.edits[0]).toBe(
				"Remove the nodes in template.project.json that point into .; Rogen generates those now."
			);
		});

		it("should copy a template it can't parse as it is, and say what to remove", () => {
			const content = '{ "name": "mine", "tree": ';
			const files = withTemplate(
				{ kind: "copy", from: "default.project.json" },
				content
			);

			expect(files.template?.content).toBe(content);
			expect(files.nextSteps.edits[0]).toBe(
				"Remove the nodes in template.project.json that point into src; Rogen generates those now."
			);
		});

		const copyWithMounts = (
			copiedTemplate: string,
			mountList: InitChoices["mounts"]
		) =>
			planProject({
				choices: {
					...defaultInitChoices(luau, "default", new Set(), false),
					template: { kind: "copy", from: "default.project.json" },
					mounts: mountList,
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(["default.project.json"]),
				copiedTemplate,
			}).unwrap();

		it("should add the chosen package mounts a copied template lacks", () => {
			const files = copyWithMounts(
				JSON.stringify({
					name: "my-game",
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Assets: { $path: "assets" } },
					},
				}),
				[
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
				]
			);

			expect(JSON.parse(files.template?.content ?? "").tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					Assets: { $path: "assets" },
					Packages: { $path: "Packages" },
				},
				ServerScriptService: {
					ServerPackages: { $path: { optional: "ServerPackages" } },
				},
			});
			expect(files.notes[1]).toBe(
				"Added Packages at ReplicatedStorage/Packages and ServerPackages at ServerScriptService/ServerPackages to template.project.json."
			);
		});

		it("should name every mount it adds under one node", () => {
			const files = copyWithMounts(
				JSON.stringify({ name: "my-game", tree: {} }),
				[
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
				]
			);

			expect(files.notes[1]).toBe(
				"Added include at ReplicatedStorage/rbxts_include and node_modules/@rbxts at ReplicatedStorage/rbxts_include/node_modules/@rbxts to template.project.json."
			);
		});

		it("should keep a copied template as it is when it already mounts the packages", () => {
			const content = JSON.stringify({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Deps: { $path: "./Packages" } },
					ServerScriptService: {
						Server: { $path: "ServerPackages" },
					},
				},
			});
			const files = copyWithMounts(content, [
				{
					path: "Packages",
					optional: false,
					landing: "ReplicatedStorage/Packages",
				},
				{
					path: "ServerPackages",
					optional: false,
					landing: "ServerScriptService/ServerPackages",
				},
			]);

			expect(files.template?.content).toBe(content);
			expect(files.notes).toHaveLength(1);
		});

		it("should not mount a folder inside one the template already mounts", () => {
			const content = JSON.stringify({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: {
						rbxts_include: {
							$path: "include",
							node_modules: { $path: "node_modules" },
						},
					},
				},
			});
			const files = copyWithMounts(content, [
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

			expect(files.template?.content).toBe(content);
		});

		it("should say which mounts it left out because the template has a node in their place", () => {
			const content = JSON.stringify({
				name: "my-game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "vendor" } },
				},
			});
			const files = copyWithMounts(content, [
				{
					path: "Packages",
					optional: false,
					landing: "ReplicatedStorage/Packages",
				},
			]);

			expect(files.template?.content).toBe(content);
			expect(files.notes[1]).toBe(
				"Didn't add Packages at ReplicatedStorage/Packages to template.project.json, since it already has a node there."
			);
		});

		it("should say which packages to mount when it can't parse a copied template", () => {
			const files = copyWithMounts('{ "tree": ', [
				{
					path: "Packages",
					optional: false,
					landing: "ReplicatedStorage/Packages",
				},
			]);

			expect(files.nextSteps.edits).toContain(
				"Mount Packages in template.project.json; Rogen couldn't read it to add the mount."
			);
		});

		it("should reference a used project file as it is", () => {
			const files = withTemplate({
				kind: "use",
				file: "base.project.json",
			});

			expect(files.template).toBeUndefined();
			expect(configOf(files, "default.rogen.json").template).toBe(
				"base.project.json"
			);
		});
	});

	describe("package mounts", () => {
		const rbxts: Partial<DetectedWorkspace> = { language: "roblox-ts" };

		it("should mount include and @rbxts for roblox-ts, and the scopes it found", () => {
			expect(
				treeOf({
					...rbxts,
					languageFacts: robloxTsFacts({
						rbxtsScopes: ["@rbxts", "@flamework"],
						hasInclude: true,
					}),
				})
			).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					rbxts_include: {
						$path: "include",
						node_modules: {
							$className: "Folder",
							"@rbxts": { $path: "node_modules/@rbxts" },
							"@flamework": { $path: "node_modules/@flamework" },
						},
					},
				},
			});
		});

		it("should mount include and @rbxts as optional for roblox-ts when missing", () => {
			expect(treeOf(rbxts).ReplicatedStorage).toEqual({
				rbxts_include: {
					$path: { optional: "include" },
					node_modules: {
						$className: "Folder",
						"@rbxts": {
							$path: { optional: "node_modules/@rbxts" },
						},
					},
				},
			});
		});

		it("should not mount a scope that is not installed by default", () => {
			const scopes = treeOf({
				...rbxts,
				languageFacts: robloxTsFacts({
					rbxtsScopes: ["@rbxts"],
					hasInclude: true,
				}),
			}).ReplicatedStorage.rbxts_include.node_modules;

			expect(Object.keys(scopes)).toEqual(["$className", "@rbxts"]);
		});

		it("should never mount include or a scope for luau", () => {
			expect(
				treeOf({
					languageFacts: robloxTsFacts({
						hasInclude: true,
						rbxtsScopes: ["@rbxts"],
					}),
				})
			).toBeUndefined();
		});

		it("should mount wally packages that exist", () => {
			expect(
				treeOf({
					packageManager: "wally",
					packageDirs: new Set(["Packages", "ServerPackages"]),
				})
			).toEqual({
				$className: "DataModel",
				ReplicatedStorage: { Packages: { $path: "Packages" } },
				ServerScriptService: {
					ServerPackages: { $path: "ServerPackages" },
				},
			});
		});

		it("should mount the wally directories that are missing as optional", () => {
			expect(treeOf(withPackages)).toEqual({
				$className: "DataModel",
				...mounts,
			});
		});

		it("should mount wally packages as optional when only wally.toml exists", () => {
			expect(treeOf({ packageManager: "wally" })).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					Packages: { $path: { optional: "Packages" } },
				},
				ServerScriptService: {
					ServerPackages: { $path: { optional: "ServerPackages" } },
				},
			});
		});

		it("should mount pesde packages that exist", () => {
			expect(
				treeOf({
					packageManager: "pesde",
					packageDirs: new Set([
						"roblox_packages",
						"roblox_server_packages",
					]),
				})
			).toEqual({
				$className: "DataModel",
				ReplicatedStorage: { Packages: { $path: "roblox_packages" } },
				ServerScriptService: {
					ServerPackages: { $path: "roblox_server_packages" },
				},
			});
		});

		it("should only mount the directories of the detected manager", () => {
			expect(
				treeOf({
					packageManager: "pesde",
					packageDirs: new Set(["Packages", "ServerPackages"]),
				})
			).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					Packages: { $path: { optional: "roblox_packages" } },
				},
				ServerScriptService: {
					ServerPackages: {
						$path: { optional: "roblox_server_packages" },
					},
				},
			});
		});

		it("should assume wally for luau without a manager", () => {
			expect(
				treeOf({
					packageDirs: new Set(["Packages", "roblox_packages"]),
				})
			).toEqual({
				$className: "DataModel",
				ReplicatedStorage: mounts.ReplicatedStorage,
			});
		});

		it("should not mount package directories for roblox-ts without a manager", () => {
			expect(
				treeOf({
					language: "roblox-ts",
					languageFacts: robloxTsFacts({
						rbxtsScopes: ["@rbxts"],
						hasInclude: true,
					}),
					packageDirs: new Set(["Packages"]),
				}).ReplicatedStorage.Packages
			).toBeUndefined();
		});

		it("should combine mounts from several sources under one service", () => {
			const tree = treeOf({
				...withPackages,
				language: "roblox-ts",
				languageFacts: robloxTsFacts({ rbxtsScopes: ["@rbxts"] }),
			});

			expect(Object.keys(tree)).toEqual([
				"$className",
				"ReplicatedStorage",
				"ServerScriptService",
			]);
			expect(tree.ReplicatedStorage).toMatchObject({
				rbxts_include: expect.anything(),
				Packages: expect.anything(),
			});
		});
	});

	describe("choices", () => {
		const planChoices = (choices: Partial<InitChoices>) =>
			planProject({
				choices: {
					...defaultInitChoices(luau, "default", new Set(), false),
					...choices,
				},
				projectName: "my-game",
				directory,
				existingFiles: new Set(),
			}).unwrap();

		it("should write the chosen root dirs", () => {
			const files = planChoices({ rootDirs: ["src", "shared"] });

			expect(configOf(files, "default.rogen.json").rootDirs).toEqual([
				"src",
				"shared",
			]);
		});

		it("should write the chosen sync dir", () => {
			const files = planChoices({
				language: toolchain.getLanguage("roblox-ts"),
				syncDir: "lib",
			});

			expect(configOf(files, "default.rogen.json").syncDir).toBe("lib");
		});

		it("should write optional mounts as optional paths", () => {
			const files = planChoices({
				mounts: [
					{
						path: "Packages",
						optional: true,
						landing: "ReplicatedStorage/Packages",
					},
					{
						path: "ServerPackages",
						optional: false,
						landing: "ServerScriptService/ServerPackages",
					},
				],
			});

			expect(JSON.parse(files.template!.content).tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: {
					Packages: { $path: { optional: "Packages" } },
				},
				ServerScriptService: {
					ServerPackages: { $path: "ServerPackages" },
				},
			});
		});

		it("should not write a template when no mount was chosen", () => {
			const files = planChoices({ mounts: [] });

			expect(files.template).toBeUndefined();
			expect(
				configOf(files, "default.rogen.json").template
			).toBeUndefined();
		});

		it("should extend the source config without a sync dir when none was chosen", () => {
			const files = planChoices({
				darklua: true,
				syncDir: undefined,
			});

			expect(
				configOf(files, "default.rogen.json").syncDir
			).toBeUndefined();
		});
	});

	describe("notes", () => {
		it("should say where roblox-ts syncs from", () => {
			expect(
				plan(
					withRobloxTs(
						{ ...luau, language: "roblox-ts" },
						{ outDir: "out" }
					)
				).notes
			).toEqual(["Syncing from out, where roblox-ts compiles to."]);
		});

		it("should say nothing for plain luau", () => {
			expect(plan(luau).notes).toEqual([]);
		});
	});

	describe("existing files", () => {
		it("should fail when the config it would write exists", () => {
			const result = planResult(luau, "default", ["default.rogen.json"]);

			expect(result.isErr()).toBe(true);
			expect(errorsOf(result)).toMatchObject([
				{
					code: "init.configExists",
					resource: path.join(directory, "default.rogen.json"),
				},
			]);
		});

		it("should allow a named config beside an existing default config", () => {
			const result = planResult(luau, "lobby", ["default.rogen.json"]);

			expect(result.isOk()).toBe(true);
		});

		it("should report every darklua config that already exists", () => {
			const result = planResult({ ...luau, darklua: true }, "default", [
				"source.rogen.json",
				"default.rogen.json",
			]);

			expect(errorsOf(result).map((error) => error.resource)).toEqual([
				path.join(directory, "source.rogen.json"),
				path.join(directory, "default.rogen.json"),
			]);
		});

		it("should not fail over an existing template or project file", () => {
			const result = planResult({ ...luau, ...withPackages }, "default", [
				"template.project.json",
				"default.project.json",
			]);

			expect(result.isOk()).toBe(true);
		});
	});
});

describe("defaultInitChoices", () => {
	it("should copy a hand-written project file the config would replace", () => {
		expect(
			defaultInitChoices(
				luau,
				"default",
				new Set(["default.project.json"]),
				false
			).template
		).toEqual({ kind: "copy", from: "default.project.json" });
	});

	it("should leave a project file that a config writes alone", () => {
		expect(
			defaultInitChoices(
				luau,
				"lobby",
				new Set(["lobby.project.json", "lobby.rogen.json"]),
				false
			).template
		).toEqual({ kind: "new" });
	});

	it("should take the detected places only when asked to", () => {
		const workspace = { ...luau, places: ["lobby"] };
		expect(
			defaultInitChoices(workspace, "default", new Set(), true).places
		).toEqual(["lobby"]);
		expect(
			defaultInitChoices(workspace, "default", new Set(), false).places
		).toEqual([]);
	});
});

describe("parseInitName", () => {
	it("should reject template, which would write over the template", () => {
		expect(parseInitName(["template"]).isErr()).toBe(true);
	});

	it("should default to the default config name", () => {
		expect(parseInitName([]).unwrap()).toBe("default");
	});

	it("should accept a single name", () => {
		expect(parseInitName(["lobby"]).unwrap()).toBe("lobby");
	});

	it.each(["a/b", "a\\b", "..", "."])("should reject %s", (name) => {
		expect(parseInitName([name]).isErr()).toBe(true);
	});

	it("should reject an empty name", () => {
		expect(parseInitName([" "]).isErr()).toBe(true);
	});

	it("should reject more than one name", () => {
		expect(parseInitName(["a", "b"]).isErr()).toBe(true);
	});
});
