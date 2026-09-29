import path from "path";
import {
	ancestors,
	contains,
	isInside,
	joinPosix,
	normalizeDir,
	outermostDirs,
	relativeTo,
	stemOf,
	toPosix,
} from "../path.js";

describe("Path", () => {
	describe("toPosix", () => {
		it("should convert Windows backslashes to forward slashes", () => {
			const mockWindowsPath = `src${path.sep}core${path.sep}module.ts`;
			expect(toPosix(mockWindowsPath)).toBe("src/core/module.ts");
		});

		it("should return POSIX paths unmodified", () => {
			expect(toPosix("src/core/module.ts")).toBe("src/core/module.ts");
		});
	});

	describe("joinPosix", () => {
		it("should join segments and write the result with forward slashes", () => {
			expect(joinPosix("/repo/src", "Inventory", "Save.luau")).toBe(
				"/repo/src/Inventory/Save.luau"
			);
		});

		it("should resolve dot segments", () => {
			expect(joinPosix("/repo/src", "./Net/../Save.luau")).toBe(
				"/repo/src/Save.luau"
			);
		});
	});

	describe("isInside", () => {
		const abs = (...segments: string[]) =>
			path.resolve("/repo", ...segments);

		it("should accept a nested dir", () => {
			expect(isInside(abs("src/shared"), abs("src"))).toBe(true);
		});

		it("should reject the same dir", () => {
			expect(isInside(abs("src"), abs("src"))).toBe(false);
		});

		it("should reject a sibling that shares a name prefix", () => {
			expect(isInside(abs("src-extra"), abs("src"))).toBe(false);
		});

		it("should reject a parent", () => {
			expect(isInside(abs("src"), abs("src/shared"))).toBe(false);
		});

		it("should accept a dir whose name starts with two dots", () => {
			expect(isInside(abs("src/..hidden"), abs("src"))).toBe(true);
		});
	});
});

describe("normalizeDir", () => {
	it.each([
		["src", "src"],
		["./src/", "src"],
		["src\\shared", "src/shared"],
		["src//shared/", "src/shared"],
		[".", "."],
	])("should write %j as %j", (entry, expected) => {
		expect(normalizeDir(entry)).toBe(expected);
	});

	describe("ancestors", () => {
		it("should yield each parent folder up to the root, nearest first", () => {
			const root = path.parse(path.resolve("/")).root;

			expect([...ancestors(path.resolve("/repo/src/Save.luau"))]).toEqual(
				[path.resolve("/repo/src"), path.resolve("/repo"), root]
			);
		});

		it("should yield nothing for the root", () => {
			expect([...ancestors(path.resolve("/"))]).toEqual([]);
		});

		it("should walk a POSIX path written with forward slashes", () => {
			expect([...ancestors("/repo/src/Save.luau")].slice(0, 2)).toEqual([
				"/repo/src",
				"/repo",
			]);
		});
	});

	describe("contains", () => {
		const abs = (...segments: string[]) =>
			path.resolve("/repo", ...segments);

		it("should accept the same folder and one inside it", () => {
			expect(contains(abs("src"), abs("src"))).toBe(true);
			expect(contains(abs("src"), abs("src/shared"))).toBe(true);
		});

		it("should reject a sibling and a parent", () => {
			expect(contains(abs("src"), abs("src-extra"))).toBe(false);
			expect(contains(abs("src/shared"), abs("src"))).toBe(false);
		});
	});

	describe("outermostDirs", () => {
		const abs = (...segments: string[]) =>
			path.resolve("/repo", ...segments);

		it("should drop repeats and dirs inside another, whichever comes first", () => {
			expect(
				outermostDirs([
					abs("src/shared"),
					abs("src"),
					abs("src"),
					abs("src-extra"),
				])
			).toEqual([abs("src"), abs("src-extra")]);
		});
	});

	describe("relativeTo", () => {
		const abs = (...segments: string[]) =>
			path.resolve("/repo", ...segments);

		it("should give the path from the folder", () => {
			expect(relativeTo(abs(), abs("src/Save.luau"))).toBe(
				path.join("src", "Save.luau")
			);
		});

		it("should name the folder itself with a dot", () => {
			expect(relativeTo(abs("src"), abs("src"))).toBe(".");
		});
	});

	describe("stemOf", () => {
		it("should drop the extension", () => {
			expect(stemOf("Save.luau")).toBe("Save");
			expect(stemOf("Save.server.luau")).toBe("Save.server");
		});

		it("should keep a name that has no extension", () => {
			expect(stemOf("Save")).toBe("Save");
		});
	});
});
