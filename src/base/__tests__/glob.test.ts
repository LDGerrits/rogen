import {
	escapedGlobPrefix,
	isGlobsetMatch,
	isMatch,
	unescapedGlob,
} from "../glob.js";

describe("a folder prefix of a glob", () => {
	it.each([
		"/repo/My Game (1)",
		"/repo/{a,b}",
		"/repo/a|b",
		"/repo/[x]",
		"/repo/a+b",
		"/repo/!a",
		"/repo/a*b",
		"C:/Users/x (1)",
	])("should match only %s once escaped", (directory) => {
		const glob = `${escapedGlobPrefix(directory)}/**/*.spec.luau`;

		expect(isMatch(`${directory}/src/A.spec.luau`, glob)).toBe(true);
		expect(isMatch(`${directory}/src/A.luau`, glob)).toBe(false);
	});

	it("should come back as written once unescaped", () => {
		const glob = `${escapedGlobPrefix("/repo/a (1)/{b}")}/**/*.spec.luau`;

		expect(unescapedGlob(glob)).toBe("/repo/a (1)/{b}/**/*.spec.luau");
	});
});

describe("isMatch", () => {
	it("should match dot files", () => {
		expect(isMatch("/repo/.hidden/A.luau", "/repo/**/A.luau")).toBe(true);
	});
});

describe("isGlobsetMatch", () => {
	it.each([
		["a.luau", "*.luau", true],
		["dir/a.luau", "*.luau", true],
		["a.lua", "*.{lua,luau}", true],
		["a.luau", "*.{lua,luau}", true],
		["a.luaus", "*.{lua,luau}", false],
		["a.Luau", "*.luau", false],
		["a.luau", "?.luau", true],
		["ab.luau", "?.luau", false],
		["a.luau", "[ab].luau", true],
		["c.luau", "[!ab].luau", true],
		["c.luau", "[^ab].luau", true],
		["a.luau", "[!ab].luau", false],
		["a/b/c.luau", "**/c.luau", true],
		["c.luau", "**/c.luau", true],
		["a/b/c.luau", "a/**", true],
		["a/c.luau", "a/**/c.luau", true],
		["a/x/y/c.luau", "a/**/c.luau", true],
		["a.luau", "a.luau", true],
		["a.luau", "A.luau", false],
		["a.b", "a\\.b", true],
		["axb", "a\\.b", false],
		["a*b", "a\\*b", true],
		["x.js", "*.{js,{ts,tsx}}", true],
		["x.tsx", "*.{js,{ts,tsx}}", true],
		["a(b).luau", "a(b).luau", true],
		[".hidden.luau", "*.luau", true],
	])("should test %s against %s as %s", (name, glob, matches) => {
		expect(isGlobsetMatch(name, glob)).toBe(matches);
	});
});
