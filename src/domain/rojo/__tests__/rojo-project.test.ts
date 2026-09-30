import {
	ContainerFactory,
	RojoNode,
	RojoProject,
	RojoTree,
} from "../rojo-project.js";

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

		it("should hand out a copy that can't change the project", () => {
			const project = new RojoProject(baseTree, folders);

			delete project.getTree().tree.ServerScriptService;

			expect(project.getNode(["ServerScriptService"])).toBeDefined();
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

	describe("parse", () => {
		it("should read a project file, keeping the fields it doesn't model", () => {
			const project = RojoProject.parse(
				'{ "name": "Game", "servePort": 34872, "tree": { "$className": "DataModel" } }'
			).unwrap();

			expect(project.getTree()).toEqual({
				name: "Game",
				servePort: 34872,
				tree: { $className: "DataModel" },
			});
		});

		it("should read comments and trailing commas", () => {
			const project = RojoProject.parse(
				'{ // note\n "tree": {},\n}'
			).unwrap();

			expect(project.getTree().tree).toEqual({});
		});

		it("should give a file without a tree a bare DataModel", () => {
			const project = RojoProject.parse(
				'{ "globIgnorePaths": [] }'
			).unwrap();

			expect(project.getTree().tree).toEqual({ $className: "DataModel" });
		});

		it("should fail on syntax errors", () => {
			expect(RojoProject.parse("{ nope").isErr()).toBe(true);
		});

		it("should fail when the file isn't an object", () => {
			const result = RojoProject.parse("[]");

			expect(result.isErr() && result.error.message).toBe(
				"it must be a JSON object."
			);
		});

		it("should fail when the tree isn't an object", () => {
			const result = RojoProject.parse('{ "tree": 5 }');

			expect(result.isErr() && result.error.message).toBe(
				"its tree must be an object."
			);
		});

		it("should create ancestors the plain way unless told otherwise", () => {
			const project = RojoProject.parse('{ "tree": {} }').unwrap();

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
	});

	describe("name and globIgnorePaths", () => {
		it("should read the project's own name, unless it is empty", () => {
			expect(RojoProject.parse('{ "name": "Game" }').unwrap().name).toBe(
				"Game"
			);
			expect(
				RojoProject.parse('{ "name": "" }').unwrap().name
			).toBeUndefined();
			expect(RojoProject.parse("{}").unwrap().name).toBeUndefined();
		});

		it("should keep the globs that are strings", () => {
			const project = RojoProject.parse(
				'{ "globIgnorePaths": ["a", 3, "b"] }'
			).unwrap();

			expect(project.globIgnorePaths).toEqual(["a", "b"]);
			expect(RojoProject.parse("{}").unwrap().globIgnorePaths).toEqual(
				[]
			);
		});
	});

	describe("mergeMissing", () => {
		const additions = (tree: RojoNode) =>
			new RojoProject({ tree }, folders);

		it("should add a mount that nothing is at yet, creating its containers", () => {
			const project = new RojoProject(baseTree, folders);

			const result = project.mergeMissing(
				additions({
					ReplicatedStorage: {
						Packages: { $path: "Packages" },
					},
				})
			);

			expect(project.getNode(["ReplicatedStorage", "Packages"])).toEqual({
				$path: "Packages",
			});
			expect(result).toEqual({
				added: [
					{
						path: "Packages",
						instancePath: ["ReplicatedStorage", "Packages"],
					},
				],
				skipped: [],
			});
		});

		it("should add into a container that is already there", () => {
			const project = new RojoProject(baseTree, folders);

			project.mergeMissing(
				additions({
					ServerScriptService: { Vendor: { $path: "vendor" } },
				})
			);

			expect(project.getTree().tree.ServerScriptService).toEqual({
				$className: "ServerScriptService",
				Vendor: { $path: "vendor" },
			});
		});

		it("should skip a mount where a node already is, and keep that node", () => {
			const project = new RojoProject(
				{
					name: "x",
					tree: {
						ReplicatedStorage: { Packages: { $path: "mine" } },
					},
				},
				folders
			);

			const result = project.mergeMissing(
				additions({
					ReplicatedStorage: { Packages: { $path: "Packages" } },
				})
			);

			expect(project.getNode(["ReplicatedStorage", "Packages"])).toEqual({
				$path: "mine",
			});
			expect(result.skipped).toEqual([
				{
					path: "Packages",
					instancePath: ["ReplicatedStorage", "Packages"],
				},
			]);
			expect(result.added).toEqual([]);
		});

		it("should not create a container when nothing goes in it", () => {
			const project = new RojoProject(baseTree, folders);

			project.mergeMissing(additions({ Lighting: {} }));

			expect(project.getNode(["Lighting"])).toBeUndefined();
		});
	});
});
