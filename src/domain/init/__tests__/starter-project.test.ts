import { StarterProject } from "../starter-project.js";

const mount = (path: string, landing: string, optional = false) => ({
	path,
	optional,
	landing,
});
const include = mount("include", "ReplicatedStorage/rbxts_include");
const rbxts = mount(
	"node_modules/@rbxts",
	"ReplicatedStorage/rbxts_include/node_modules/@rbxts"
);
const flamework = mount(
	"node_modules/@flamework",
	"ReplicatedStorage/rbxts_include/node_modules/@flamework"
);
const packages = mount("Packages", "ReplicatedStorage/Packages");

const parsed = (project: unknown): StarterProject =>
	StarterProject.parse(JSON.stringify(project)).unwrap();

const treeOf = (project: StarterProject) => project.toConfig().tree;

describe("StarterProject", () => {
	describe("fromMounts", () => {
		it("should start at the DataModel that mounts each folder at its landing", () => {
			const project = StarterProject.fromMounts([
				packages,
				mount(
					"ServerPackages",
					"ServerScriptService/ServerPackages",
					true
				),
			]);

			expect(project.toConfig()).toEqual({
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "Packages" } },
					ServerScriptService: {
						ServerPackages: {
							$path: { optional: "ServerPackages" },
						},
					},
				},
			});
		});

		it("should start at a bare DataModel when there is nothing to mount", () => {
			expect(StarterProject.fromMounts([]).toConfig()).toEqual({
				tree: { $className: "DataModel" },
			});
		});
	});

	describe("parse", () => {
		it("should read a project file", () => {
			expect(
				treeOf(parsed({ name: "x", tree: { $className: "DataModel" } }))
			).toEqual({
				$className: "DataModel",
			});
		});

		it.each(["{ nope", "[]", '{ "tree": 5 }'])(
			"should give up on %j",
			(text) => {
				expect(StarterProject.parse(text).isErr()).toBe(true);
			}
		);
	});

	describe("toConfig", () => {
		it("should give the keys of the file without its schema", () => {
			const project = parsed({
				$schema: "https://example.com/project.json",
				name: "x",
				servePort: 34872,
				tree: { $className: "DataModel" },
			});

			expect(project.toConfig()).toEqual({
				name: "x",
				servePort: 34872,
				tree: { $className: "DataModel" },
			});
		});
	});

	describe("withoutNodesIn", () => {
		const project = {
			name: "x",
			tree: {
				$path: "src",
				ServerScriptService: {
					Server: { $path: "src/server" },
					Kept: { $path: "Packages" },
				},
			},
		};

		it("should drop the nodes that point into the dirs Rogen generates, and say where they were", () => {
			const result = parsed(project).withoutNodesIn(["src"]);

			expect(result?.removed).toEqual([
				{
					path: "src/server",
					instancePath: ["ServerScriptService", "Server"],
					settings: {},
				},
			]);
			expect(treeOf(result!.project)).toEqual({
				$path: "src",
				ServerScriptService: { Kept: { $path: "Packages" } },
			});
		});

		it("should hand back what a removed node carried besides its $path", () => {
			const result = parsed({
				tree: {
					$className: "DataModel",
					Workspace: {
						Map: {
							$path: "src/map",
							$className: "Model",
							$properties: { Locked: true },
							Spawn: { $className: "SpawnLocation" },
						},
					},
				},
			}).withoutNodesIn(["src"]);

			expect(result?.removed).toEqual([
				{
					path: "src/map",
					instancePath: ["Workspace", "Map"],
					settings: {
						$className: "Model",
						$properties: { Locked: true },
						Spawn: { $className: "SpawnLocation" },
					},
				},
			]);
		});

		it("should leave a mount in the tree whose folder holds an init file", () => {
			const result = parsed(project)
				.withInitIn(["./src/server/"])
				.withoutNodesIn(["src"]);

			expect(result?.removed).toEqual([]);
			expect(treeOf(result!.project)).toMatchObject({
				ServerScriptService: { Server: { $path: "src/server" } },
			});
		});

		it("should say which mounts it keeps, and the folders that are mounted", () => {
			const held = parsed(project).withInitIn(["src/server"]);

			expect(held.keptMounts(["src"])).toEqual([
				{
					path: "src/server",
					instancePath: ["ServerScriptService", "Server"],
				},
			]);
			expect(held.keptMounts(["lib"])).toEqual([]);
			expect(held.mountedFolders()).toEqual([
				"src",
				"src/server",
				"Packages",
			]);
		});

		it("should put removed mounts back, with their $path or as the settings alone", () => {
			const original = parsed({
				tree: {
					$className: "DataModel",
					Workspace: {
						Map: {
							$path: "src/map",
							$properties: { Locked: true },
						},
						Plain: { $path: "src/plain" },
					},
				},
			});
			const { project: stripped, removed } = original.withoutNodesIn([
				"src",
			])!;

			expect(treeOf(stripped.withMountsReturned(removed, true))).toEqual({
				$className: "DataModel",
				Workspace: {
					Map: { $path: "src/map", $properties: { Locked: true } },
					Plain: { $path: "src/plain" },
				},
			});
			expect(treeOf(stripped.withMountsReturned(removed, false))).toEqual(
				{
					$className: "DataModel",
					Workspace: {
						Map: {
							$className: "Folder",
							$properties: { Locked: true },
						},
					},
				}
			);
		});

		it("should say whether routes can place code in the tree", () => {
			expect(
				parsed({ tree: { $className: "DataModel" } }).takesRoutes
			).toBe(true);
			expect(parsed({ tree: { $path: "src" } }).takesRoutes).toBe(false);
		});

		it("should not touch what points elsewhere", () => {
			const result = parsed(project).withoutNodesIn(["lib"]);

			expect(result?.removed).toEqual([]);
		});

		it("should give up when a dir is the whole folder", () => {
			expect(parsed(project).withoutNodesIn(["."])).toBeUndefined();
		});
	});

	describe("withMounts", () => {
		it("should list what it adds in tree order", () => {
			const { added } = parsed({ tree: {} }).withMounts([
				include,
				rbxts,
				packages,
				flamework,
			]);

			expect(added).toEqual([
				"include at ReplicatedStorage/rbxts_include",
				"node_modules/@rbxts at ReplicatedStorage/rbxts_include/node_modules/@rbxts",
				"node_modules/@flamework at ReplicatedStorage/rbxts_include/node_modules/@flamework",
				"Packages at ReplicatedStorage/Packages",
			]);
		});

		it("should skip every mount below a node the project already has there", () => {
			const tree = {
				ReplicatedStorage: { rbxts_include: { $className: "Folder" } },
			};

			const result = parsed({ tree }).withMounts([include, rbxts]);

			expect(result.added).toEqual([]);
			expect(result.skipped).toEqual([
				"include at ReplicatedStorage/rbxts_include",
				"node_modules/@rbxts at ReplicatedStorage/rbxts_include/node_modules/@rbxts",
			]);
			expect(treeOf(result.project)).toEqual(tree);
		});

		it("should leave a mount alone that the project already mounts, itself or through a parent", () => {
			const project = parsed({
				tree: {
					ReplicatedStorage: { Packages: { $path: "Packages" } },
				},
			});

			const result = project.withMounts([
				packages,
				mount("Packages/sub", "X/Sub"),
			]);

			expect(result.added).toEqual([]);
			expect(result.skipped).toEqual([]);
		});

		it("should not change the project it was called on", () => {
			const project = parsed({ tree: {} });

			project.withMounts([packages]);

			expect(treeOf(project)).toEqual({});
		});
	});
});
