import {
	capitalized,
	closestMatch,
	joinedWithAnd,
	listLimited,
	plural,
} from "../strings.js";

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

describe("closestMatch", () => {
	it("should find a word with one letter wrong, missing or extra", () => {
		expect(closestMatch("rootDir", ["rootDirs", "routes"])).toBe(
			"rootDirs"
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
