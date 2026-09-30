import { compareStrings, groupBy } from "../collections.js";

describe("groupBy", () => {
	it("should group items under their key in the order they appear", () => {
		const groups = groupBy(
			["apple", "avocado", "banana", "cherry", "blueberry"],
			(word) => word[0]
		);

		expect([...groups]).toEqual([
			["a", ["apple", "avocado"]],
			["b", ["banana", "blueberry"]],
			["c", ["cherry"]],
		]);
	});

	it("should store a value derived from each item when asked", () => {
		const groups = groupBy(
			["a/x.luau", "a/y.luau", "b/z.luau"],
			(file) => file.split("/")[0],
			(file) => file.split("/")[1]
		);

		expect([...groups]).toEqual([
			["a", ["x.luau", "y.luau"]],
			["b", ["z.luau"]],
		]);
	});

	it("should key on identity when the key is an object", () => {
		const first = { id: 1 };
		const second = { id: 1 };

		const groups = groupBy([first, second, first], (item) => item);

		expect(groups.get(first)).toEqual([first, first]);
		expect(groups.get(second)).toEqual([second]);
	});
});

describe("compareStrings", () => {
	it("should order code points and return 0 for equal strings", () => {
		expect(["b", "B", "a", "a"].sort(compareStrings)).toEqual([
			"B",
			"a",
			"a",
			"b",
		]);
		expect(compareStrings("a", "a")).toBe(0);
	});
});
