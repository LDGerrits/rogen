import path from "path";
import {
	PathSet,
	ancestors,
	commonAncestor,
	contains,
	containsPath,
	pathKey,
	containsPosix,
	dirnamePosix,
	isInside,
	joinPosix,
	normalizeDir,
	outermostDirs,
	relativeTo,
	samePath,
	stemOf,
	toNative,
	toPosix,
} from "../path.js";

describe("PathSet", () => {
	it("should find a path written with either kind of separator", () => {
		const files = new PathSet(["C:\\repo\\default.rogen.json"]);

		expect(files.has("C:/repo/default.rogen.json")).toBe(true);
		expect(files.has("C:\\repo\\default.rogen.json")).toBe(true);
	});

	it("should not find a path it was not given", () => {
		expect(new PathSet(["/repo/a.json"]).has("/repo/b.json")).toBe(false);
	});
});

describe("Path", () => {
	describe("samePath", () => {
		it("should accept paths that resolve to one place", () => {
			expect(samePath("/repo/src", "/repo/src/")).toBe(true);
			expect(samePath("/repo/src", "/repo/other/../src")).toBe(true);
		});

		it("should refuse another path", () => {
			expect(samePath("/repo/src", "/repo/src/a")).toBe(false);
		});
	});

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

	describe("dirnamePosix", () => {
		it("should give the directory of a relative path", () => {
			expect(dirnamePosix("Net/server/Remote.luau")).toBe("Net/server");
		});

		it("should give an empty directory for a path at the top", () => {
			expect(dirnamePosix("Remote.luau")).toBe("");
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

		it("should take the same folder written another way as the same", () => {
			expect(contains(abs("src"), `${abs("src")}${path.sep}`)).toBe(true);
			expect(contains(`${abs("src")}${path.sep}`, abs("src"))).toBe(true);
		});

		it("should reject a sibling and a parent", () => {
			expect(contains(abs("src"), abs("src-extra"))).toBe(false);
			expect(contains(abs("src/shared"), abs("src"))).toBe(false);
		});
	});

	describe("containsPosix", () => {
		it("should accept the same path and one under it", () => {
			expect(containsPosix("src", "src")).toBe(true);
			expect(containsPosix("src", "src/shared")).toBe(true);
		});

		it("should reject a sibling that shares a prefix, and a parent", () => {
			expect(containsPosix("src", "src-extra")).toBe(false);
			expect(containsPosix("src/shared", "src")).toBe(false);
		});
	});

	describe("containsPath", () => {
		it("should compare as text where the file system tells letter cases apart", () => {
			expect(containsPath("/repo/Src", "/repo/Src/a", false)).toBe(true);
			expect(containsPath("/repo/Src", "/repo/src/a", false)).toBe(false);
		});

		it("should ignore letter case where the file system does", () => {
			expect(containsPath("C:/Repo/Src", "c:/repo/src/a", true)).toBe(
				true
			);
			expect(containsPath("C:/Repo/Src", "c:/repo/src", true)).toBe(true);
			expect(containsPath("C:/Repo/Src", "c:/repo/src-extra", true)).toBe(
				false
			);
		});
	});

	describe("pathKey", () => {
		it("should be one string for the paths that name one file", () => {
			expect(pathKey("/repo/src/../Out.json", false)).toBe(
				path.resolve("/repo/Out.json")
			);
			expect(pathKey("/repo/Out.json", true)).toBe(
				pathKey("/repo/out.JSON", true)
			);
		});

		it("should tell letter cases apart unless asked not to", () => {
			expect(pathKey("/repo/Out.json", false)).not.toBe(
				pathKey("/repo/out.json", false)
			);
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

	describe("commonAncestor", () => {
		const abs = (...segments: string[]) =>
			path.resolve("/repo", ...segments);

		it("should be the directory itself when there is one", () => {
			expect(commonAncestor([abs("src")])).toBe(abs("src"));
		});

		it("should be the shared parent of sibling directories", () => {
			expect(commonAncestor([abs("core"), abs("lobby")])).toBe(abs("."));
		});

		it("should tell letter cases apart unless asked not to", () => {
			expect(commonAncestor([abs("Core/a"), abs("core/b")], false)).toBe(
				abs(".")
			);
			expect(commonAncestor([abs("Core/a"), abs("core/b")], true)).toBe(
				abs("Core")
			);
		});

		it("should be the deepest directory containing every one", () => {
			expect(
				commonAncestor([
					abs("places/main/src"),
					abs("places/common/src"),
				])
			).toBe(abs("places"));
		});

		it("should not match on a shared name prefix that is not a whole segment", () => {
			expect(commonAncestor([abs("src"), abs("src-extra")])).toBe(
				abs(".")
			);
		});

		it("should throw when there are no directories", () => {
			expect(() => commonAncestor([])).toThrow();
		});
	});
});

describe("toNative", () => {
	it("should turn every forward slash into the platform's separator", () => {
		expect(toNative("C:/repo/src\\Net/Http.luau", path.win32)).toBe(
			"C:\\repo\\src\\Net\\Http.luau"
		);
	});

	it("should leave a POSIX path as it is, backslashes and all", () => {
		expect(toNative("/repo/src/a\\b.luau", path.posix)).toBe(
			"/repo/src/a\\b.luau"
		);
	});
});
