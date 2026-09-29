import { RojoNode, RojoTree } from "../rojo-tree.js";
import { ContainerFactory, RojoProject } from "../rojo-project.js";

const folders: ContainerFactory = (instancePath) =>
	instancePath.length === 1 ? {} : { $className: "Folder" };

describe("RojoProject", () => {
	let baseTree: RojoTree;

	beforeEach(() => {
		baseTree = {
			name: "test-tree",
			tree: {
				ServerScriptService: { $className: "ServerScriptService" },
			},
		};
	});

	describe("getTree", () => {
		it("should hold a deep clone of the tree it was given", () => {
			const project = new RojoProject(baseTree, folders);

			expect(project.getTree()).toEqual(baseTree);
			expect(project.getTree()).not.toBe(baseTree);
		});
	});

	describe("getNode", () => {
		it("should find a node by its instance path", () => {
			const project = new RojoProject(baseTree, folders);

			expect(project.getNode(["ServerScriptService"])).toEqual({
				$className: "ServerScriptService",
			});
		});

		it("should find nothing below a value that isn't a node", () => {
			const project = new RojoProject(
				{ name: "x", tree: { Workspace: "not a node" } },
				folders
			);

			expect(project.getNode(["Workspace", "Map"])).toBeUndefined();
			expect(project.getNode(["Workspace"])).toBeUndefined();
		});
	});

	describe("insertNode", () => {
		it("should create missing ancestors with the container factory", () => {
			const project = new RojoProject({ name: "x", tree: {} }, folders);

			project.insertNode(["ReplicatedStorage", "shared", "Foo"], {
				$path: "foo.luau",
			});

			expect(project.getTree().tree).toEqual({
				ReplicatedStorage: {
					shared: {
						$className: "Folder",
						Foo: { $path: "foo.luau" },
					},
				},
			});
		});

		it("should pass the factory the instance path of each ancestor it creates", () => {
			const created: string[] = [];
			const project = new RojoProject({ name: "x", tree: {} }, (path) => {
				created.push(path.join("/"));
				return {};
			});

			project.insertNode(["A", "B", "C"], { $path: "c" });

			expect(created).toEqual(["A", "A/B"]);
		});

		it("should merge into a node that already exists", () => {
			const project = new RojoProject(baseTree, folders);

			project.insertNode(["ServerScriptService"], { $path: "server" });

			expect(project.getNode(["ServerScriptService"])).toEqual({
				$className: "ServerScriptService",
				$path: "server",
			});
		});

		it("should strip a Folder class when a node gets a $path", () => {
			const project = new RojoProject(baseTree, folders);

			project.insertNode(["Workspace", "Map"], {
				$className: "Folder",
				$ignoreUnknownInstances: false,
			});
			project.insertNode(["Workspace", "Map"], { $path: "map.rbxm" });

			expect(project.getNode(["Workspace", "Map"])).toEqual({
				$path: "map.rbxm",
			});
		});

		it("should report whether a path can hold a node", () => {
			const project = new RojoProject(
				{ name: "x", tree: { Workspace: "not a node" } },
				folders
			);

			expect(project.canInsert(["Workspace", "Map"])).toBe(false);
			expect(project.canInsert(["Lighting", "Sky"])).toBe(true);
		});
	});

	describe("getPaths", () => {
		it("should list every $path depth first, the root included", () => {
			const project = new RojoProject(
				{
					name: "x",
					tree: {
						$path: "root",
						ReplicatedStorage: {
							Packages: { $path: { optional: "Packages" } },
							Lib: {
								$path: "lib",
								Inner: { $path: "lib/inner" },
							},
						},
						Lighting: { $properties: { Brightness: 2 } },
					},
				},
				folders
			);

			expect(project.getPaths()).toEqual([
				{ path: "root", instancePath: [] },
				{
					path: { optional: "Packages" },
					instancePath: ["ReplicatedStorage", "Packages"],
				},
				{ path: "lib", instancePath: ["ReplicatedStorage", "Lib"] },
				{
					path: "lib/inner",
					instancePath: ["ReplicatedStorage", "Lib", "Inner"],
				},
			]);
		});
	});

	describe("removeNodes", () => {
		it("should remove each node whose $path matches, with everything below it", () => {
			const project = new RojoProject(
				{
					name: "x",
					tree: {
						$path: "src",
						ServerScriptService: {
							Server: {
								$path: "src/server",
								Child: { $path: "x" },
							},
							Kept: { $path: "Packages" },
						},
					},
				},
				folders
			);

			const removed = project.removeNodes((path) => path !== "Packages");

			expect(removed).toEqual([["ServerScriptService", "Server"]]);
			expect(project.getTree().tree).toEqual({
				$path: "src",
				ServerScriptService: { Kept: { $path: "Packages" } },
			});
		});
	});

	describe("mapPaths", () => {
		it("should rewrite every $path, keeping each one's form", () => {
			const project = new RojoProject(
				{
					name: "x",
					tree: {
						$path: "a",
						Child: {
							$path: { optional: "b" },
							$properties: { $path: "not a path" },
						},
					},
				},
				folders
			);

			project.mapPaths((target) => `../${target}`);

			const tree = project.getTree().tree;
			expect(tree.$path).toBe("../a");
			expect((tree.Child as RojoNode).$path).toEqual({
				optional: "../b",
			});
			expect((tree.Child as RojoNode).$properties).toEqual({
				$path: "not a path",
			});
		});
	});
});
