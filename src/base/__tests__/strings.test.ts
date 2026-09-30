import { capitalized, listLimited, plural } from "../strings.js";

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
