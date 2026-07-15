import fs from "fs";
import {
	applyCasing,
	getOrCreateNode,
	sortObject,
	pruneObject,
	findMissingPaths,
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
