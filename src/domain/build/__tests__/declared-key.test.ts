import {
	matchFolderKey,
	matchKeyIgnoringCase,
	matchMarkerKey,
	matchSuffixKeys,
	unwrapInvisibleFolder,
} from "../declared-key.js";

const ROUTES = new Set(["server", "client", "shared"]);
const ROUTES_AND_TAGS = new Set([
	"server",
	"client",
	"shared",
	"mock",
	"debug",
]);

describe("matchFolderKey", () => {
	it("matches a folder named exactly after a declared key", () => {
		expect(matchFolderKey("server", ROUTES)).toBe("server");
	});

	it("matches with the first letter in the other case and reports the declared key", () => {
		expect(matchFolderKey("Server", ROUTES)).toBe("server");
		expect(matchFolderKey("server", new Set(["Server"]))).toBe("Server");
	});

	it("does not match any other difference in case", () => {
		expect(matchFolderKey("SERVER", ROUTES)).toBeUndefined();
		expect(matchFolderKey("sERVER", ROUTES)).toBeUndefined();
	});

	it("does not match an undeclared name", () => {
		expect(matchFolderKey("Inventory", ROUTES)).toBeUndefined();
	});
});

describe("matchMarkerKey", () => {
	it("matches a marker file named after a declared key", () => {
		expect(matchMarkerKey(".server", ROUTES)).toBe("server");
	});

	it("matches a tag marker", () => {
		expect(matchMarkerKey(".mock", ROUTES_AND_TAGS)).toBe("mock");
	});

	it("matches with the first letter in the other case", () => {
		expect(matchMarkerKey(".Server", ROUTES)).toBe("server");
	});

	it("does not match any other difference in case", () => {
		expect(matchMarkerKey(".SERVER", ROUTES)).toBeUndefined();
	});

	it("ignores a name that doesn't start with a dot", () => {
		expect(matchMarkerKey("server", ROUTES)).toBeUndefined();
	});

	it("ignores a bare dot", () => {
		expect(matchMarkerKey(".", ROUTES)).toBeUndefined();
	});
});

describe("matchSuffixKeys", () => {
	it("strips a separator suffix for each of + - _ . @", () => {
		for (const sep of ["+", "-", "_", ".", "@"]) {
			const result = matchSuffixKeys(`Combat${sep}server`, ROUTES);
			expect(result.baseName).toBe("Combat");
			expect(result.matchedKeys).toEqual(new Set(["server"]));
		}
	});

	it("matches a PascalCase suffix (CombatServer)", () => {
		const result = matchSuffixKeys("CombatServer", ROUTES);
		expect(result.baseName).toBe("Combat");
		expect(result.matchedKeys).toEqual(new Set(["server"]));
	});

	it("does not match HTTPServer: the preceding letter is capitalised", () => {
		const result = matchSuffixKeys("HTTPServer", ROUTES);
		expect(result.baseName).toBe("HTTPServer");
		expect(result.matchedKeys.size).toBe(0);
	});

	it("accepts the accidental match HttpClient", () => {
		const result = matchSuffixKeys("HttpClient", ROUTES);
		expect(result.baseName).toBe("Http");
		expect(result.matchedKeys).toEqual(new Set(["client"]));
	});

	it("does not treat a bare key with nothing before it as a suffix", () => {
		const result = matchSuffixKeys("Server", ROUTES);
		expect(result.baseName).toBe("Server");
		expect(result.matchedKeys.size).toBe(0);
	});

	it("stacks suffixes in either order", () => {
		const forward = matchSuffixKeys("Foo.mock.server", ROUTES_AND_TAGS);
		expect(forward.baseName).toBe("Foo");
		expect(forward.matchedKeys).toEqual(new Set(["mock", "server"]));

		const backward = matchSuffixKeys("Foo.server.mock", ROUTES_AND_TAGS);
		expect(backward.baseName).toBe("Foo");
		expect(backward.matchedKeys).toEqual(new Set(["mock", "server"]));
	});

	it("records where each matched key sits in the stem", () => {
		const result = matchSuffixKeys("Foo.server.mock", ROUTES_AND_TAGS);
		expect(result.spans).toEqual([
			{ key: "mock", start: 10, length: 5, form: "separator" },
			{ key: "server", start: 3, length: 7, form: "separator" },
		]);
	});

	it("reports whether a key matched after a separator or as a capital word", () => {
		expect(matchSuffixKeys("HttpMock", ROUTES_AND_TAGS).spans).toEqual([
			{ key: "mock", start: 4, length: 4, form: "capital" },
		]);
	});

	it("stops the run at the first non-declared part: Foo.mock.Bar yields no keys", () => {
		const result = matchSuffixKeys("Foo.mock.Bar", ROUTES_AND_TAGS);
		expect(result.matchedKeys.size).toBe(0);
		expect(result.baseName).toBe("Foo.mock.Bar");
	});

	it("does not recognise an undeclared key even if it looks like a suffix", () => {
		const result = matchSuffixKeys("Analytics.beta", ROUTES_AND_TAGS);
		expect(result.matchedKeys.size).toBe(0);
		expect(result.baseName).toBe("Analytics.beta");
	});

	it("matches a separator suffix with the first letter in the other case", () => {
		const result = matchSuffixKeys("Foo.Server", ROUTES);
		expect(result.baseName).toBe("Foo");
		expect(result.matchedKeys).toEqual(new Set(["server"]));
	});

	it("does not match a separator suffix that differs beyond the first letter", () => {
		const result = matchSuffixKeys("Foo.SERVER", ROUTES);
		expect(result.baseName).toBe("Foo.SERVER");
		expect(result.matchedKeys.size).toBe(0);
	});

	it("does not match a capital suffix after an upper-case letter or the start", () => {
		expect(matchSuffixKeys("HTTPServer", ROUTES).matchedKeys.size).toBe(0);
		expect(matchSuffixKeys("Server", ROUTES).matchedKeys.size).toBe(0);
	});

	it("matches a capital suffix after a digit", () => {
		const result = matchSuffixKeys("Level2Server", ROUTES);
		expect(result.baseName).toBe("Level2");
	});

	it("matches a key declared with a capital in every form", () => {
		const keys = new Set(["Server"]);
		expect(matchSuffixKeys("Foo.Server", keys).baseName).toBe("Foo");
		expect(matchSuffixKeys("Foo.server", keys).baseName).toBe("Foo");
		expect(matchSuffixKeys("FooServer", keys).baseName).toBe("Foo");
		expect(matchSuffixKeys("Foo.SERVER", keys).matchedKeys.size).toBe(0);
	});

	it("names the declared key that a separator suffix only differs from beyond the first letter", () => {
		expect(matchSuffixKeys("Foo.SERVER", ROUTES).nearMissKey).toBe(
			"server"
		);
		expect(matchSuffixKeys("Foo-sHARED", ROUTES).nearMissKey).toBe(
			"shared"
		);
	});

	it("names a near miss that sits before matched suffixes", () => {
		const result = matchSuffixKeys("Foo.SERVER.mock", ROUTES_AND_TAGS);
		expect(result.matchedKeys).toEqual(new Set(["mock"]));
		expect(result.nearMissKey).toBe("server");
	});

	it("has no near miss for a first-letter match", () => {
		expect(matchSuffixKeys("Foo.Server", ROUTES).nearMissKey).toBeUndefined();
	});

	it("has no near miss for an exact match or an unrelated name", () => {
		expect(matchSuffixKeys("Foo.server", ROUTES).nearMissKey).toBeUndefined();
		expect(matchSuffixKeys("Foo.beta", ROUTES).nearMissKey).toBeUndefined();
	});
});

describe("matchKeyIgnoringCase", () => {
	it("returns the declared key that a name only differs from beyond the first letter", () => {
		expect(matchKeyIgnoringCase("SERVER", ROUTES)).toBe("server");
		expect(matchKeyIgnoringCase("sERVER", ROUTES)).toBe("server");
	});

	it("ignores a name that matches, including with the first letter flipped", () => {
		expect(matchKeyIgnoringCase("server", ROUTES)).toBeUndefined();
		expect(matchKeyIgnoringCase("Server", ROUTES)).toBeUndefined();
	});

	it("ignores an unrelated name", () => {
		expect(matchKeyIgnoringCase("Inventory", ROUTES)).toBeUndefined();
	});
});

describe("unwrapInvisibleFolder", () => {
	it("removes the parentheses and marks the folder invisible", () => {
		expect(unwrapInvisibleFolder("(mock)")).toEqual({
			name: "mock",
			invisible: true,
		});
	});

	it("leaves an ordinary name alone", () => {
		expect(unwrapInvisibleFolder("mock")).toEqual({
			name: "mock",
			invisible: false,
		});
	});

	it("ignores empty or unbalanced parentheses", () => {
		for (const name of ["()", "(mock", "mock)"])
			expect(unwrapInvisibleFolder(name)).toEqual({
				name,
				invisible: false,
			});
	});
});
