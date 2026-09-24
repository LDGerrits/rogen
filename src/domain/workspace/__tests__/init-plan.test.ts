import path from "path";
import { ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { RogenConfig } from "../../config/config.js";
import { RojoTree } from "../../rojo/rojo-tree.js";
import { DetectedWorkspace } from "../detect-workspace.js";
import { parseInitName, planInit } from "../init-plan.js";

const STARTING_ROUTES = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	shared: "ReplicatedStorage/shared",
	"*": "ReplicatedStorage/shared",
};

const directory = path.resolve("/mock/my-game");

const luau: DetectedWorkspace = {
	toolchain: "luau",
	packageDirs: new Set(),
	rbxtsScopes: [],
	hasInclude: false,
};
const withPackages: Partial<DetectedWorkspace> = {
	packageManager: "wally",
	packageDirs: new Set(["Packages"]),
};
const mounts = {
	ReplicatedStorage: { Packages: { $path: "Packages" } },
};

const planResult = (
	workspace: DetectedWorkspace,
	name = "default",
	existingFiles: readonly string[] = []
) =>
	planInit({
		name,
		workspace,
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

describe("planInit", () => {
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

		expect(config.routes).toEqual(STARTING_ROUTES);
	});

	it("should write fields in pipeline order", () => {
		const { configs } = plan(
			{ ...luau, ...withPackages, toolchain: "roblox-ts", outDir: "out" },
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
		const { configs } = plan({
			...luau,
			toolchain: "roblox-ts",
			outDir: "build",
		});

		expect(configs).toHaveLength(1);
		expect(JSON.parse(configs[0].content).syncDir).toBe("build");
	});

	describe("darklua", () => {
		const darklua: DetectedWorkspace = { ...luau, toolchain: "darklua" };

		it("should write a source config and a default config extending it", () => {
			const files = plan(darklua);

			expect(files.configs.map((config) => config.fileName)).toEqual([
				"source.rogen.json",
				"default.rogen.json",
			]);
			const source = configOf(files, "source.rogen.json");
			const child = configOf(files, "default.rogen.json");
			expect(source.syncDir).toBeUndefined();
			expect(source.routes).toEqual(STARTING_ROUTES);
			expect(child.extends).toBe("source.rogen.json");
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
				"lobby-source.rogen.json"
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
		});
	});

	describe("package mounts", () => {
		it("should mount rbxts scopes and include", () => {
			expect(
				treeOf({
					rbxtsScopes: ["@rbxts", "@flamework"],
					hasInclude: true,
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

		it("should not mount include when it does not exist", () => {
			expect(
				treeOf({ rbxtsScopes: ["@rbxts"] }).ReplicatedStorage
			).toEqual({
				rbxts_include: {
					node_modules: {
						$className: "Folder",
						"@rbxts": { $path: "node_modules/@rbxts" },
					},
				},
			});
		});

		it("should not mount include without rbxts scopes", () => {
			expect(treeOf({ hasInclude: true })).toBeUndefined();
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

		it("should mount only the wally directories that exist", () => {
			expect(treeOf(withPackages)).toEqual({
				$className: "DataModel",
				...mounts,
			});
		});

		it("should not mount wally packages that are not installed", () => {
			expect(treeOf({ packageManager: "wally" })).toBeUndefined();
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
			).toBeUndefined();
		});

		it("should not mount a package directory without a manager", () => {
			expect(
				treeOf({
					packageDirs: new Set(["Packages", "roblox_packages"]),
				})
			).toBeUndefined();
		});

		it("should combine mounts from several sources under one service", () => {
			const tree = treeOf({ ...withPackages, rbxtsScopes: ["@rbxts"] });

			expect(Object.keys(tree)).toEqual([
				"$className",
				"ReplicatedStorage",
			]);
			expect(tree.ReplicatedStorage).toMatchObject({
				rbxts_include: expect.anything(),
				Packages: expect.anything(),
			});
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
			const result = planResult(
				{ ...luau, toolchain: "darklua" },
				"default",
				["source.rogen.json", "default.rogen.json"]
			);

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

describe("parseInitName", () => {
	it("should default to the default config name", () => {
		expect(parseInitName([]).unwrap()).toBe("default");
	});

	it("should accept a single name", () => {
		expect(parseInitName(["lobby"]).unwrap()).toBe("lobby");
	});

	it.each(["a/b", "a\\b", "..", "."])("should reject %s", (name) => {
		expect(parseInitName([name]).isErr()).toBe(true);
	});

	it("should reject more than one name", () => {
		expect(parseInitName(["a", "b"]).isErr()).toBe(true);
	});
});
