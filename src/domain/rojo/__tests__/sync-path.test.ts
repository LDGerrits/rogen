import path from "path";
import {
	commonRoot,
	rebaseTemplatePath,
	relativeToProject,
	syncPath,
} from "../sync-path.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

describe("commonRoot", () => {
	it("should be the root dir itself when there is one", () => {
		expect(commonRoot([abs("src")])).toBe(abs("src"));
	});

	it("should be the shared parent of sibling root dirs", () => {
		expect(commonRoot([abs("core"), abs("lobby")])).toBe(abs("."));
	});

	it("should be the deepest directory containing every root dir", () => {
		expect(
			commonRoot([abs("places/main/src"), abs("places/common/src")])
		).toBe(abs("places"));
	});

	it("should not match on a shared name prefix that is not a whole segment", () => {
		expect(commonRoot([abs("src"), abs("src-extra")])).toBe(abs("."));
	});

	it("should throw when there are no root dirs", () => {
		expect(() => commonRoot([])).toThrow();
	});
});

describe("syncPath", () => {
	const projectDir = abs(".");

	it("should replace a single root dir with the sync dir", () => {
		const layout = {
			commonRoot: commonRoot([abs("src")]),
			syncDir: abs("out"),
			projectDir,
		};

		expect(syncPath(abs("src/Foo.ts"), layout)).toEqual({
			optional: "out/Foo.luau",
		});
	});

	it("should keep the distinguishing part of each root dir when there are several", () => {
		const layout = {
			commonRoot: commonRoot([abs("core"), abs("lobby")]),
			syncDir: abs("out"),
			projectDir,
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
			commonRoot: commonRoot([
				abs("places/main/src"),
				abs("places/main/tests"),
				abs("places/common/src"),
				abs("places/common/test"),
			]),
			syncDir: abs("out"),
			projectDir,
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
		};

		expect(syncPath(abs("src/A.ts"), layout)).toEqual({
			optional: "out/A.luau",
		});
		expect(syncPath(abs("src/ui/B.tsx"), layout)).toEqual({
			optional: "out/ui/B.luau",
		});
	});

	it("should not rewrite any other extension", () => {
		const layout = {
			commonRoot: abs("src"),
			syncDir: abs("out"),
			projectDir,
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
			};

			expect(syncPath(abs("src/Foo.luau"), layout)).toEqual({
				optional: "src/Foo.luau",
			});
		});

		it("should include ../ when the source is outside the project file's directory", () => {
			const layout = {
				commonRoot: abs("places/common/src"),
				projectDir: abs("places/main"),
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

describe("rebaseTemplatePath", () => {
	const layout = {
		commonRoot: abs("src"),
		syncDir: abs("out"),
		projectDir: abs("."),
	};

	it("should keep a Wally-style Packages path out of the sync dir", () => {
		const rebased = rebaseTemplatePath("Packages", abs("."), abs("."));

		expect(rebased).toBe("Packages");
		expect(rebased).not.toEqual(syncPath(abs("Packages"), layout));
	});

	it("should not move a template path that sits under a root dir into the sync dir", () => {
		const rebased = rebaseTemplatePath("src/vendor", abs("."), abs("."));

		expect(rebased).toBe("src/vendor");
		expect(rebased).not.toEqual(syncPath(abs("src/vendor"), layout));
	});

	it("should rebase a path when the template lives in another directory", () => {
		expect(
			rebaseTemplatePath("Packages", abs("."), abs("places/main"))
		).toBe("../../Packages");
		expect(
			rebaseTemplatePath("../Packages", abs("places/main"), abs("."))
		).toBe("places/Packages");
	});

	it("should keep the optional form of an optional template path", () => {
		expect(
			rebaseTemplatePath(
				{ optional: "include" },
				abs("."),
				abs("places/main")
			)
		).toEqual({ optional: "../../include" });
	});

	it("should leave a plain template path plain", () => {
		expect(typeof rebaseTemplatePath("include", abs("."), abs("."))).toBe(
			"string"
		);
	});
});
