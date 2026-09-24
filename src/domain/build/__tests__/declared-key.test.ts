import {
	matchFolderKey,
	matchMarkerKey,
	matchSuffixKeys,
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

	it("is case-sensitive", () => {
		expect(matchFolderKey("Server", ROUTES)).toBeUndefined();
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

	it("is case-sensitive", () => {
		expect(matchMarkerKey(".Server", ROUTES)).toBeUndefined();
	});

	it("ignores a name that doesn't start with a dot", () => {
		expect(matchMarkerKey("server", ROUTES)).toBeUndefined();
	});

	it("ignores a bare dot", () => {
		expect(matchMarkerKey(".", ROUTES)).toBeUndefined();
	});
});

describe("matchSuffixKeys", () => {
	it("strips a separator suffix for each of + - _ . @, case-insensitively", () => {
		for (const sep of ["+", "-", "_", ".", "@"]) {
			const result = matchSuffixKeys(`Combat${sep}Server`, ROUTES);
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

	it("prefers the longer of two matching forms at one position", () => {
		const result = matchSuffixKeys("Foo.Server", ROUTES);
		expect(result.baseName).toBe("Foo");
	});
});
