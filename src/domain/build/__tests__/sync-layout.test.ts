import {
	relativeToProject,
	syncLayoutOf,
	syncPath,
} from "../sync-layout.js";
import { commonAncestor } from "../../../base/path.js";
import { abs, syncTools } from "./fixtures.js";

describe("syncLayoutOf", () => {
	it("should take the project dir from the out file and the common root from the root dirs", () => {
		expect(
			syncLayoutOf(
				{
					rootDirs: [abs("src/server"), abs("src/shared")],
					syncDir: abs("out"),
					outFile: abs("game/default.project.json"),
				},
				syncTools
			)
		).toEqual({
			commonRoot: abs("src"),
			syncDir: abs("out"),
			projectDir: abs("game"),
			tools: syncTools,
		});
	});

	it("should leave the sync dir out when there is none", () => {
		expect(
			syncLayoutOf(
				{
					rootDirs: [abs("src")],
					outFile: abs("default.project.json"),
				},
				syncTools
			).syncDir
		).toBeUndefined();
	});
});

describe("syncPath", () => {
	const projectDir = abs(".");

	it("should replace a single root dir with the sync dir", () => {
		const layout = {
			commonRoot: commonAncestor([abs("src")]),
			syncDir: abs("out"),
			projectDir,
			tools: syncTools,
		};

		expect(syncPath(abs("src/Foo.ts"), layout)).toEqual({
			optional: "out/Foo.luau",
		});
	});

	it("should keep the distinguishing part of each root dir when there are several", () => {
		const layout = {
			commonRoot: commonAncestor([abs("core"), abs("lobby")]),
			syncDir: abs("out"),
			projectDir,
			tools: syncTools,
		};

		expect(syncPath(abs("core/Foo.luau"), layout)).toEqual({
			optional: "out/core/Foo.luau",
		});
		expect(syncPath(abs("lobby/Bar.luau"), layout)).toEqual({
			optional: "out/lobby/Bar.luau",
		});
	});

	it("should emit what rbxtsc writes for a multi-place repo", () => {
		const layout = {
			commonRoot: commonAncestor([
				abs("places/main/src"),
				abs("places/main/tests"),
				abs("places/common/src"),
				abs("places/common/test"),
			]),
			syncDir: abs("out"),
			projectDir,
			tools: syncTools,
		};

		expect(syncPath(abs("places/main/src/server"), layout)).toEqual({
			optional: "out/main/src/server",
		});
		expect(syncPath(abs("places/common/src/server"), layout)).toEqual({
			optional: "out/common/src/server",
		});
		expect(
			syncPath(abs("places/common/test/tests/server"), layout)
		).toEqual({ optional: "out/common/test/tests/server" });
	});

	it("should emit a path relative to the project file's directory", () => {
		const layout = {
			commonRoot: abs("src"),
			syncDir: abs("out"),
			projectDir: abs("places/main"),
			tools: syncTools,
		};

		expect(syncPath(abs("src/Foo.luau"), layout)).toEqual({
			optional: "../../out/Foo.luau",
		});
	});

	it("should rewrite .ts and .tsx to .luau", () => {
		const layout = {
			commonRoot: abs("src"),
			syncDir: abs("out"),
			projectDir,
			tools: syncTools,
		};

		expect(syncPath(abs("src/A.ts"), layout)).toEqual({
			optional: "out/A.luau",
		});
		expect(syncPath(abs("src/ui/B.tsx"), layout)).toEqual({
			optional: "out/ui/B.luau",
		});
	});

	it("should rewrite nothing when no processor contributes", () => {
		const layout = {
			commonRoot: abs("src"),
			syncDir: abs("out"),
			projectDir,
			tools: [],
		};

		expect(syncPath(abs("src/A.ts"), layout)).toEqual({
			optional: "out/A.ts",
		});
	});

	it("should apply whatever a processor contributes", () => {
		const layout = {
			commonRoot: abs("src"),
			syncDir: abs("out"),
			projectDir,
			tools: [{ id: "minify", emittedPath: (p: string) => `${p}.min` }],
		};

		expect(syncPath(abs("src/A.luau"), layout)).toEqual({
			optional: "out/A.luau.min",
		});
	});

	it("should not rewrite any other extension", () => {
		const layout = {
			commonRoot: abs("src"),
			syncDir: abs("out"),
			projectDir,
			tools: syncTools,
		};

		for (const name of [
			"A.luau",
			"A.lua",
			"A.rbxm",
			"A.json",
			"A.tsx.bak",
			"A.mts",
		]) {
			expect(syncPath(abs("src", name), layout)).toEqual({
				optional: `out/${name}`,
			});
		}
	});

	it("should leave directories untouched apart from the root swap", () => {
		const layout = {
			commonRoot: abs("src"),
			syncDir: abs("out"),
			projectDir,
			tools: syncTools,
		};

		expect(syncPath(abs("src/Inventory"), layout)).toEqual({
			optional: "out/Inventory",
		});
	});

	describe("without a sync dir", () => {
		it("should point at the real path relative to the project file", () => {
			const layout = {
				commonRoot: abs("src"),
				projectDir,
				tools: syncTools,
			};

			expect(syncPath(abs("src/Foo.luau"), layout)).toEqual({
				optional: "src/Foo.luau",
			});
		});

		it("should include ../ when the source is outside the project file's directory", () => {
			const layout = {
				commonRoot: abs("places/common/src"),
				projectDir: abs("places/main"),
				tools: syncTools,
			};

			expect(syncPath(abs("places/common/src/Foo.luau"), layout)).toEqual(
				{ optional: "../common/src/Foo.luau" }
			);
		});

		it("should not rewrite .ts", () => {
			expect(
				syncPath(abs("src/Foo.ts"), {
					commonRoot: abs("src"),
					projectDir,
					tools: syncTools,
				})
			).toEqual({ optional: "src/Foo.ts" });
		});
	});
});

describe("relativeToProject", () => {
	it("should write posix separators", () => {
		expect(relativeToProject(abs("roblox_packages/lib"), abs("."))).toBe(
			"roblox_packages/lib"
		);
	});
});
