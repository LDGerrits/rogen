import {
	escapedGlobPrefix,
	isGlobsetMatch,
	isMatch,
	ignoresAllOf,
	ignoringAllOf,
	ignoringGlob,
	withGlobBody,
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

describe("ignoresAllOf", () => {
	it.each([
		["/repo/vendor", "/repo/vendor/**"],
		["/repo/vendor", "/repo/v*/**"],
		["/repo/vendor", "/repo/**/vendor/**"],
	])("should say %s is all ignored by %s", (target, glob) => {
		expect(ignoresAllOf(glob, target)).toBe(true);
	});

	it.each([
		["/repo/vendor", "/repo/vendor"],
		["/repo/vendor", "/repo/vendor/"],
		["/repo/vendor", "/repo/**/vendor"],
		["/repo/vendor/A.luau", "/repo/**/*.luau"],
		["/repo/vendor/A.luau", "/repo/vendor/A.luau"],
		["/repo/vendor", "/repo/vendor/*"],
		["/repo/vendor", "/repo/vendor/*.luau"],
		["/repo/vendor", "/repo/**/*.luau"],
		["/repo/vendor", "/repo/vendor/**/*.luau"],
		["/repo/vendor", "/repo/other/**"],
	])("should say %s is not all ignored by %s", (target, glob) => {
		expect(ignoresAllOf(glob, target)).toBe(false);
	});
});

describe("ignoringGlob", () => {
	it.each([
		["a/X.spec.luau", ["**/*.spec.luau"], "**/*.spec.luau"],
		[
			"a/Keep.spec.luau",
			["**/*.spec.luau", "!**/Keep.spec.luau"],
			undefined,
		],
		[
			"a/Keep.spec.luau",
			["!**/Keep.spec.luau", "**/*.spec.luau"],
			"**/*.spec.luau",
		],
		[
			"a/Keep.spec.luau",
			["**/*.spec.luau", "!**/Keep.spec.luau", "a/**"],
			"a/**",
		],
		["a/X.luau", ["!a/X.luau"], undefined],
		["!a.luau", ["\\!a.luau"], "\\!a.luau"],
	])("should say %s is ignored by %j as %s", (target, globs, glob) => {
		expect(ignoringGlob(target, globs)).toBe(glob);
	});
});

describe("ignoringAllOf", () => {
	it("should name the glob that ignores all of a folder", () => {
		expect(ignoringAllOf("/r/v", ["/r/v/**", "*.md"])).toBe("/r/v/**");
	});

	it("should name none when a negation after it may re-include a file", () => {
		expect(ignoringAllOf("/r/v", ["/r/v/**", "!**/Keep.luau"])).toBe(
			undefined
		);
	});
});

describe("withGlobBody", () => {
	it("should change the pattern and keep its negation", () => {
		const prefixed = (glob: string) =>
			withGlobBody(glob, (body) => `src/${body}`);

		expect([prefixed("*.luau"), prefixed("!Keep.luau")]).toEqual([
			"src/*.luau",
			"!src/Keep.luau",
		]);
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
		["a", "a/**", false],
		["foo", "foo**", true],
		["foobar", "foo**", true],
		["fo", "foo**", false],
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
		["/p/src/deep/x.tmp.luau", "/p/*.tmp.luau", true],
		["/p/src/deep/x.tmp.luau", "/p/src/*.tmp.luau", true],
		["/p/src/deep", "/p/src/deep", true],
		["/p/src/deep", "/p/src/deep/", false],
		["/p/src/deep/x.luau", "/p/src/deep", false],
		["/p/src/deep/x.luau", "/p/src/deep/**", true],
		["a!b.luau", "a[!]b.luau", true],
		["axb.luau", "a[!]b.luau", false],
	])("should test %s against %s as %s", (name, glob, matches) => {
		expect(isGlobsetMatch(name, glob)).toBe(matches);
	});
});
