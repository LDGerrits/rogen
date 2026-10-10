import { escapedGlobPrefix, isMatch, unescapedGlob } from "../glob.js";

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
