import { capitalized, listLimited } from "../string.js";

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
