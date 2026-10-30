import {
	capitalized,
	closestMatch,
	closestMatches,
	defanged,
	joinedWithAnd,
	listLimited,
	plural,
	shellWord,
	unlistedNote,
} from "../strings.js";

describe("defanged", () => {
	it("should leave ordinary text, newlines and tabs alone", () => {
		expect(defanged("a\tb\nc ü 日本")).toBe("a\tb\nc ü 日本");
	});

	it("should write control characters as escapes, so a file name cannot drive the terminal", () => {
		expect(defanged("a\u001b]0;x\u0007\u001b[2Jb\r\u007f\u009b")).toBe(
			"a\\u001b]0;x\\u0007\\u001b[2Jb\\u000d\\u007f\\u009b"
		);
	});

	it("should write a line separator and a bidirectional override as escapes", () => {
		expect(defanged("a\u2028b\u202ec")).toBe("a\\u2028b\\u202ec");
	});

	it("should break a line that starts a workflow command", () => {
		expect(defanged("x\n::error::pwned\n  ::warning::y")).toBe(
			"x\n\\u003a:error::pwned\n  \\u003a:warning::y"
		);
	});

	it("should leave a colon pair inside a line", () => {
		expect(defanged("a::b")).toBe("a::b");
	});
});

describe("capitalized", () => {
	it("should uppercase the first letter and keep the rest", () => {
		expect(capitalized("client")).toBe("Client");
		expect(capitalized("mockData")).toBe("MockData");
		expect(capitalized("Server")).toBe("Server");
	});
});

describe("listLimited", () => {
	it("should join every item when there are no more than the limit", () => {
		expect(listLimited(["a", "b", "c"], 3)).toBe("a, b, c");
	});

	it("should stop at the limit and add an ellipsis", () => {
		expect(listLimited(["a", "b", "c", "d"], 3)).toBe("a, b, c, …");
	});

	it("should be empty for no items", () => {
		expect(listLimited([], 3)).toBe("");
	});
});

describe("plural", () => {
	it("should keep the noun singular for one", () => {
		expect(plural(1, "config")).toBe("1 config");
	});

	it.each([0, 2, 20])("should add an s for %i", (count) => {
		expect(plural(count, "file")).toBe(`${count} files`);
	});
});

describe("unlistedNote", () => {
	it("should use the singular verb for one", () => {
		expect(unlistedNote(1)).toBe("1 more like it isn't listed.");
	});

	it("should use the plural verb for more", () => {
		expect(unlistedNote(2)).toBe("2 more like it aren't listed.");
	});
});

describe("closestMatches", () => {
	it("should give every candidate as close as the closest, in the order given", () => {
		expect(closestMatches("serer", ["sever", "client", "server"])).toEqual([
			"sever",
			"server",
		]);
	});

	it("should give only the closest when one is nearer", () => {
		expect(closestMatches("serv", ["server", "serve"])).toEqual(["serve"]);
	});

	it("should give none when nothing is close", () => {
		expect(closestMatches("zzz", ["server"])).toEqual([]);
	});
});

describe("closestMatch", () => {
	it("should find a word with one letter wrong, missing or extra", () => {
		expect(closestMatch("sourcePath", ["sourcePaths", "routes"])).toBe(
			"sourcePaths"
		);
		expect(closestMatch("tamplate", ["tags", "template"])).toBe("template");
	});

	it("should count two swapped letters as one edit", () => {
		expect(closestMatch("jsno", ["json", "all"])).toBe("json");
		expect(closestMatch("biuld", ["build", "init"])).toBe("build");
	});

	it("should match a word that differs only in case", () => {
		expect(
			closestMatch("serverscriptservice", ["ServerScriptService"])
		).toBe("ServerScriptService");
	});

	it("should prefer the nearest candidate", () => {
		expect(closestMatch("lobyy", ["lobb", "lobby"])).toBe("lobby");
	});

	it("should find nothing when every candidate is too far", () => {
		expect(
			closestMatch("prod", ["build", "where", "init"])
		).toBeUndefined();
		expect(closestMatch("ab", ["cd"])).toBeUndefined();
		expect(closestMatch("x", [])).toBeUndefined();
	});
});

describe("joinedWithAnd", () => {
	it.each([
		[["a"], "a"],
		[["a", "b"], "a and b"],
		[["a", "b", "c"], "a, b and c"],
		[[], ""],
	])("should join %j as %j", (items, joined) => {
		expect(joinedWithAnd(items)).toBe(joined);
	});
});

describe("shellWord", () => {
	it.each([
		["places/lobby/a.json", "places/lobby/a.json"],
		["my game", "'my game'"],
		["it's", "'it'\\''s'"],
	])("should write %s as %s", (arg, word) => {
		expect(shellWord(arg)).toBe(word);
	});
});
