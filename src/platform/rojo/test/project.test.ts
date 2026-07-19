import { RojoProject } from "../project.js";
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
});
