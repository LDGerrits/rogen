import { RojoProject } from "../project.js";
import { MemoryFileSystem } from "../../fs/memory-file-system.js";
import { RojoNode, RojoTree } from "../tree.js";

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

	it("should initialize with a deep clone of the tree", () => {
		const project = new RojoProject(baseTree);
		const currentTree = project.getTree();

		expect(currentTree).toEqual(baseTree);
		expect(currentTree).not.toBe(baseTree);
	});

	it("should insert nodes correctly at deep paths", () => {
		const project = new RojoProject(baseTree);

		project.insertNode(["ServerScriptService", "server", "Combat"], {
			$path: "out/combat.luau",
		});

		const tree = project.getTree().tree;

		const sss = tree["ServerScriptService"] as RojoNode;
		const server = sss["server"] as RojoNode;
		const combat = server["Combat"] as RojoNode;

		expect(server.$className).toBe("Folder");
		expect(combat.$path).toBe("out/combat.luau");
	});

	it("should strip $className when a Folder is overwritten by a file", () => {
		const project = new RojoProject(baseTree);

		project.insertNode(["Workspace", "Map"], { $className: "Folder" });
		project.insertNode(["Workspace", "Map"], { $path: "map.rbxm" });

		const tree = project.getTree().tree;

		const workspace = tree["Workspace"] as RojoNode;
		const map = workspace["Map"] as RojoNode;

		expect(map.$className).toBeUndefined();
		expect(map.$path).toBe("map.rbxm");
	});

	it("should prune dead paths that do not exist physically", async () => {
		const fs = new MemoryFileSystem();
		const project = new RojoProject({
			name: "test",
			tree: {
				KeepMe: { $path: "src/valid.luau" },
				DeleteMe: { $path: "src/invalid.luau" },
			},
		});

		await fs.writeFile("src/valid.luau", "print('hello')");
		const removed = await project.pruneDeadPaths(fs, ".", "out");

		const tree = project.getTree().tree;

		expect(removed).toEqual(["src/invalid.luau"]);
		expect(tree["KeepMe"]).toBeDefined();
		expect(tree["DeleteMe"]).toBeUndefined();
	});
});
