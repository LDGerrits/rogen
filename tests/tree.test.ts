import fs from "fs";
import {
	applyCasing,
	getOrCreateNode,
	sortObject,
	pruneObject,
	findMissingPaths,
	collapseFolders,
} from "../src/tree.js";
import { Casing, RojoNode } from "../src/types.js";
import { jest } from "@jest/globals";
import path from "path";

describe("Tree Utilities", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe("getOrCreateNode", () => {
		it("should create a node with a className if it does not exist", () => {
			const parent: RojoNode = {};
			const result = getOrCreateNode(parent, "MyFolder", "Folder");
			expect(parent.MyFolder).toBeDefined();
			expect(result.$className).toBe("Folder");
		});

		it("should return the existing node if it already exists", () => {
			const parent: RojoNode = { MyFolder: { $path: "src/MyFolder" } };
			const result = getOrCreateNode(parent, "MyFolder", "Folder");
			expect(result).toEqual({ $path: "src/MyFolder" });
		});
	});

	describe("applyCasing", () => {
		it("should uppercase the first character for PascalCase", () => {
			expect(applyCasing("testServiceUtils", "PascalCase")).toBe(
				"TestServiceUtils"
			);
		});

		it("should lowercase the first character for camelCase", () => {
			expect(applyCasing("TestServiceUtils", "camelCase")).toBe(
				"testServiceUtils"
			);
		});

		it("should preserve capitalization after the first character", () => {
			expect(applyCasing("testHTTPService", "PascalCase")).toBe(
				"TestHTTPService"
			);
			expect(applyCasing("TestHTTPService", "camelCase")).toBe(
				"testHTTPService"
			);
		});

		it.each<Casing>(["PascalCase", "camelCase"])(
			"should return an empty string for %s",
			(casing) => {
				expect(applyCasing("", casing)).toBe("");
			}
		);
	});

	describe("sortObject", () => {
		it("should recursively sort object keys alphabetically", () => {
			const unsorted = {
				Zebra: { B: 1, A: 2 },
				Apple: { D: 4, C: 3 },
			};

			const sorted = sortObject(unsorted);

			expect(Object.keys(sorted)).toEqual(["Apple", "Zebra"]);
			expect(Object.keys(sorted.Apple)).toEqual(["C", "D"]);
			expect(Object.keys(sorted.Zebra)).toEqual(["A", "B"]);
		});
	});

	describe("pruneObject", () => {
		it("should remove nodes with invalid paths outside the build directory", () => {
			const buildDir = "out";
			const outputDir = "/mock/project/dir";
			const removed: any[] = [];

			const tree: RojoNode = {
				ValidInBuild: { $path: "out/valid" },
				ValidExternal: { $path: "node_modules/@rbxts" },
				InvalidExternal: { $path: "missing_folder/file" },
			};

			jest.spyOn(fs, "existsSync").mockImplementation((pathStr) =>
				String(pathStr).includes("@rbxts")
			);

			const pruned = pruneObject(tree, buildDir, outputDir, removed);

			expect(pruned.ValidInBuild).toBeDefined();
			expect(pruned.ValidExternal).toBeDefined();
			expect(pruned.InvalidExternal).toBeUndefined();
		});
	});

	describe("findMissingPaths (Output-Relative Pathing)", () => {
		afterEach(() => {
			jest.restoreAllMocks();
		});

		it("should resolve missing paths relative to the outputDir", () => {
			const buildDir = "build";
			const outputDir = "/root/rojo/generated";
			const tree: RojoNode = {
				System: { $path: "build/systems/Combat.luau" },
			};

			jest.spyOn(fs, "existsSync").mockReturnValue(false);

			const missing = findMissingPaths(tree, buildDir, outputDir);

			const expectedAbsolutePath = path.resolve(
				outputDir,
				"build/systems/Combat.luau"
			);

			expect(missing.length).toBe(1);
			expect(missing[0].treePath).toBe("System");
			expect(missing[0].absolutePath).toBe(expectedAbsolutePath);
		});
	});
});

describe("collapseFolders", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("should collapse a pure folder perfectly matching the disk structure", () => {
		const buildDir = "out";
		const outputDir = "/mock/project/dir";

		const tree: RojoNode = {
			MathUtils: {
				Add: { $path: "out/MathUtils/Add.luau" },
				Subtract: { $path: "out/MathUtils/Subtract.luau" },
			},
		};

		jest.spyOn(fs, "readdirSync").mockImplementation(((
			dir: fs.PathLike
		) => {
			if (String(dir).endsWith("MathUtils"))
				return ["Add.luau", "Subtract.luau"];
			return [];
		}) as any);

		collapseFolders(tree, buildDir, outputDir);

		const mathUtils = tree.MathUtils as RojoNode;
		expect(mathUtils.$path).toBe("out/MathUtils");
		expect(mathUtils.Add).toBeUndefined();
		expect(mathUtils.Subtract).toBeUndefined();
	});

	it("should NOT collapse a folder if Rogen dropped a file (Count Check fails)", () => {
		const buildDir = "out";
		const outputDir = "/mock/project/dir";

		const tree: RojoNode = {
			MathUtils: {
				Add: { $path: "out/MathUtils/Add.luau" },
			},
		};

		jest.spyOn(fs, "readdirSync").mockImplementation(((
			dir: fs.PathLike
		) => {
			if (String(dir).endsWith("MathUtils"))
				return ["Add.luau", "Subtract.luau"];
			return [];
		}) as any);

		collapseFolders(tree, buildDir, outputDir);

		const mathUtils = tree.MathUtils as RojoNode;
		expect(mathUtils.$path).toBeUndefined();
		expect(mathUtils.Add).toBeDefined();
	});

	it("should NOT collapse a folder if Rogen altered a file name (Name Check fails)", () => {
		const buildDir = "out";
		const outputDir = "/mock/project/dir";

		const tree: RojoNode = {
			Systems: {
				Combat: { $path: "out/Systems/Combat.dev.luau" },
			},
		};

		jest.spyOn(fs, "readdirSync").mockImplementation(((
			dir: fs.PathLike
		) => {
			if (String(dir).endsWith("Systems")) return ["Combat.dev.luau"];
			return [];
		}) as any);

		collapseFolders(tree, buildDir, outputDir);

		const systems = tree.Systems as RojoNode;
		expect(systems.$path).toBeUndefined();
		expect(systems.Combat).toBeDefined();
	});

	it("should safely handle Rojo's script type extensions during the Name Check", () => {
		const buildDir = "out";
		const outputDir = "/mock/project/dir";

		const tree: RojoNode = {
			ServerLogic: {
				Main: { $path: "out/ServerLogic/Main.server.lua" },
			},
		};

		jest.spyOn(fs, "readdirSync").mockImplementation(((
			dir: fs.PathLike
		) => {
			if (String(dir).endsWith("ServerLogic")) return ["Main.server.lua"];
			return [];
		}) as any);

		collapseFolders(tree, buildDir, outputDir);

		const serverLogic = tree.ServerLogic as RojoNode;
		expect(serverLogic.$path).toBe("out/ServerLogic");
		expect(serverLogic.Main).toBeUndefined();
	});

	it("should NOT collapse a folder if its children come from different physical directories (Multi-source)", () => {
		const buildDir = "out";
		const outputDir = "/mock/project/dir";

		const tree: RojoNode = {
			UI: {
				Button: { $path: "out/core/ui/Button.luau" },
				Card: { $path: "out/plugins/ui/Card.luau" },
			},
		};

		jest.spyOn(fs, "readdirSync").mockImplementation(((
			dir: fs.PathLike
		) => {
			const d = String(dir).replace(/\\/g, "/");
			if (d.endsWith("core/ui")) return ["Button.luau"];
			if (d.endsWith("plugins/ui")) return ["Card.luau"];
			return [];
		}) as any);

		collapseFolders(tree, buildDir, outputDir);

		const ui = tree.UI as RojoNode;

		expect(ui.$path).toBeUndefined();
		expect(ui.Button).toBeDefined();
		expect(ui.Card).toBeDefined();
	});

	it("should NOT collapse nodes that contain virtual wrappers without a native $path", () => {
		const buildDir = "out";
		const outputDir = "/mock/project/dir";

		const tree: RojoNode = {
			ServerScriptService: {
				server: {
					Main: { $path: "out/server/Main.server.lua" },
				},
			},
		};

		jest.spyOn(fs, "readdirSync").mockImplementation(((
			dir: fs.PathLike
		) => {
			const d = String(dir).replace(/\\/g, "/");
			if (d.endsWith("server")) return ["Main.server.lua"];
			if (d.endsWith("ServerScriptService")) return ["server"];
			return [];
		}) as any);

		collapseFolders(tree, buildDir, outputDir);

		const sss = tree.ServerScriptService as RojoNode;
		expect(sss.$path).toBeUndefined();
		expect(sss.server).toBeDefined();
	});

	it("should NOT collapse folders outside of the specified build directory (Proximity Check)", () => {
		const buildDir = "out";
		const outputDir = "/mock/project/dir";

		const tree: RojoNode = {
			Packages: {
				Runtime: { $path: "node_modules/@rbxts/Runtime.lua" },
			},
		};

		jest.spyOn(fs, "readdirSync").mockImplementation(((
			dir: fs.PathLike
		) => {
			const d = String(dir).replace(/\\/g, "/");
			if (d.endsWith("node_modules/@rbxts")) return ["Runtime.lua"];
			return [];
		}) as any);

		collapseFolders(tree, buildDir, outputDir);

		const packages = tree.Packages as RojoNode;
		expect(packages.$path).toBeUndefined();
		expect(packages.Runtime).toBeDefined();
	});

	it("should recursively collapse pure, deeply nested folders", () => {
		const buildDir = "out";
		const outputDir = "/mock/project/dir";

		const tree: RojoNode = {
			Systems: {
				Combat: {
					Melee: { $path: "out/Systems/Combat/Melee.luau" },
					Ranged: { $path: "out/Systems/Combat/Ranged.luau" },
				},
				Core: { $path: "out/Systems/Core.luau" },
			},
		};

		jest.spyOn(fs, "readdirSync").mockImplementation(((
			dir: fs.PathLike
		) => {
			const d = String(dir).replace(/\\/g, "/");
			if (d.endsWith("Systems/Combat"))
				return ["Melee.luau", "Ranged.luau"];
			if (d.endsWith("Systems")) return ["Combat", "Core.luau"];
			return [];
		}) as any);

		collapseFolders(tree, buildDir, outputDir);

		const systems = tree.Systems as RojoNode;
		expect(systems.$path).toBe("out/Systems");
		expect(systems.Combat).toBeUndefined();
		expect(systems.Core).toBeUndefined();
	});

	it("should abort gracefully and not crash if the target directory does not exist yet", () => {
		const buildDir = "out";
		const outputDir = "/mock/project/dir";

		const tree: RojoNode = {
			MathUtils: {
				Add: { $path: "out/MathUtils/Add.luau" },
			},
		};

		jest.spyOn(fs, "readdirSync").mockImplementation(() => {
			throw new Error("ENOENT: no such file or directory");
		});

		expect(() => {
			collapseFolders(tree, buildDir, outputDir);
		}).not.toThrow();

		const mathUtils = tree.MathUtils as RojoNode;
		expect(mathUtils.$path).toBeUndefined();
		expect(mathUtils.Add).toBeDefined();
	});
});
