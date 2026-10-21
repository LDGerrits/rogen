import { CompiledLayout } from "../compiled-layout.js";
import { BuildTree } from "../build-tree.js";
import { abs, configOf, syncTools } from "./fixtures.js";

const treeOf = (spec: Parameters<typeof configOf>[0] = {}) => {
	const config = configOf(spec);
	return new BuildTree(config, new CompiledLayout(config, syncTools));
};

const mounting = (target: string) => ({
	tree: {
		$className: "DataModel",
		ReplicatedStorage: { $className: "ReplicatedStorage", $path: target },
	},
});

describe("BuildTree", () => {
	it("should start from a bare DataModel without a tree", () => {
		expect(treeOf().edit().getFile()).toEqual({
			tree: { $className: "DataModel" },
		});
	});

	it("should mount a path relative to the config's folder", () => {
		const tree = treeOf({ project: mounting("Packages") });

		expect(tree.getNode(["ReplicatedStorage"])).toMatchObject({
			$path: "Packages",
		});
		expect(tree.mounts.paths).toEqual([abs("Packages")]);
	});

	it("should mount a path of a config in another folder relative to that folder", () => {
		const tree = treeOf({
			file: abs("places/main/default.rogen.json"),
			project: mounting("Packages"),
		});

		expect(tree.mounts.paths).toEqual([abs("places/main/Packages")]);
	});

	describe("globIgnorePaths", () => {
		it("should keep the globs as written", () => {
			expect(
				treeOf({
					project: {
						tree: {},
						globIgnorePaths: ["**/*.spec.luau", 3],
					},
				}).globIgnorePaths
			).toEqual(["**/*.spec.luau"]);
		});

		it("should have none without any", () => {
			expect(treeOf().globIgnorePaths).toEqual([]);
		});
	});

	describe("mounts", () => {
		const tree = treeOf({
			project: {
				tree: {
					ReplicatedStorage: {
						Vendor: { $path: "vendor" },
						Shared: { $path: { optional: "shared" } },
					},
				},
			},
		});

		it("should find the mount at or above a path", () => {
			expect(
				tree.mounts.covering(abs("vendor/deep/Lib.luau"))?.node
			).toEqual(["ReplicatedStorage", "Vendor"]);
			expect(tree.mounts.covering(abs("vendor"))?.node).toEqual([
				"ReplicatedStorage",
				"Vendor",
			]);
			expect(tree.mounts.covering(abs("other"))).toBeUndefined();
		});

		it("should find an optional mount", () => {
			expect(tree.mounts.at(abs("shared"))?.node).toEqual([
				"ReplicatedStorage",
				"Shared",
			]);
		});

		it("should list the mounts inside a folder", () => {
			expect(
				tree.mounts.inside(abs(".")).map(({ node }) => node.join("/"))
			).toEqual(["ReplicatedStorage/Vendor", "ReplicatedStorage/Shared"]);
			expect(tree.mounts.inside(abs("vendor"))).toEqual([]);
		});
	});

	describe("sourcePathErrors", () => {
		const errorsOf = (target: string, sourcePaths: string[]) =>
			treeOf({ project: mounting(target) }).mounts.sourcePathErrors(
				sourcePaths
			);

		it("should be an error to mount a source path", () => {
			const [error, ...rest] = errorsOf("src", [abs("src")]);

			expect(rest).toEqual([]);
			expect(error).toMatchObject({
				code: "tree.mountsSourcePath",
				resource: abs("default.rogen.json"),
			});
			expect(error.message).toContain(
				`"ReplicatedStorage" mounts the source path ${abs("src")}`
			);
		});

		it("should be an error to mount a folder that holds a source path", () => {
			const [error] = errorsOf(".", [abs("src")]);

			expect(error.code).toBe("tree.mountsSourcePath");
			expect(error.message).toContain(
				`which holds the source path ${abs("src")}`
			);
		});

		it("should accept a mount beside or inside a source path", () => {
			expect(errorsOf("vendor", [abs("src")])).toEqual([]);
			expect(errorsOf("src/vendor", [abs("src")])).toEqual([]);
		});
	});

	describe("displacing", () => {
		const tree = treeOf({
			project: {
				tree: {
					ReplicatedStorage: {
						Vendor: { $path: "vendor" },
						Shared: {},
					},
				},
			},
		});
		const entry = { source: abs("src/Lib.luau"), sourcePath: abs("src") };

		it("should name the file's own node, and the file, when the tree defines it", () => {
			expect(
				tree.displacing({
					entry,
					instancePath: ["ReplicatedStorage", "Shared"],
					folderNodes: [],
				})
			).toEqual({
				node: ["ReplicatedStorage", "Shared"],
				source: abs("src/Lib.luau"),
			});
		});

		it("should name a folder of the file that the tree gives a $path, and that folder", () => {
			expect(
				tree.displacing({
					entry,
					instancePath: ["ReplicatedStorage", "Vendor", "Lib"],
					folderNodes: [
						{
							folder: `${abs("src")}/Vendor`,
							instancePath: ["ReplicatedStorage", "Vendor"],
						},
					],
				})
			).toEqual({
				node: ["ReplicatedStorage", "Vendor"],
				source: `${abs("src")}/Vendor`,
			});
		});

		it("should name nothing for a node the tree doesn't define", () => {
			expect(
				tree.displacing({
					entry,
					instancePath: ["ReplicatedStorage", "Other"],
					folderNodes: [],
				})
			).toBeUndefined();
		});
	});

	describe("disablesLegacyScripts", () => {
		const withLegacy = (emitLegacyScripts?: boolean) =>
			treeOf({
				project: { tree: {}, emitLegacyScripts },
			}).disablesLegacyScripts;

		it("should only be so when the config says it explicitly", () => {
			expect(withLegacy(false)).toBe(true);
			expect(withLegacy(true)).toBe(false);
			expect(withLegacy(undefined)).toBe(false);
			expect(treeOf({}).disablesLegacyScripts).toBe(false);
		});
	});

	describe("toFile", () => {
		it("should keep the config's own fields around the tree it is given", () => {
			const tree = treeOf({
				project: { tree: {}, servePort: 34872, name: "game" },
			});

			expect(tree.toFile({ Lighting: {} }, ["a"], [])).toEqual({
				name: "game",
				servePort: 34872,
				tree: { Lighting: {} },
				globIgnorePaths: ["a"],
			});
		});

		it("should write the sync rules it is given, not the config's own", () => {
			const rule = { pattern: "out/*.md", use: "text" } as const;
			const tree = treeOf({
				project: {
					tree: {},
					syncRules: [{ pattern: "*.md", use: "text" }],
				},
			});

			expect(tree.toFile({}, [], [rule])).toEqual({
				tree: {},
				syncRules: [rule],
			});
			expect(tree.toFile({}, [], [])).toEqual({ tree: {} });
		});

		it("should leave globIgnorePaths out when there are none", () => {
			expect(treeOf().toFile({}, [], [])).toEqual({ tree: {} });
		});

		it("should leave the name out when the config sets none", () => {
			expect(treeOf({ name: "game" }).toFile({}, [], [])).toEqual({
				tree: {},
			});
		});
	});
});
