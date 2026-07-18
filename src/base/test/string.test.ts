import { getClosestMatch } from "../string.js";

describe("getClosestMatch", () => {
	const targets = ["source", "template", "casing", "verbatim", "aliases"];

	it("should return an exact match if it exists", () => {
		expect(getClosestMatch("template", targets, 2)).toBe("template");
	});

	it("should return the closest match within the threshold", () => {
		expect(getClosestMatch("tmeplate", targets, 2)).toBe("template");
		expect(getClosestMatch("aliase", targets, 2)).toBe("aliases");
		expect(getClosestMatch("casiing", targets, 2)).toBe("casing");
	});

	it("should return null if no matches are within the threshold", () => {
		expect(getClosestMatch("completelyWrong", targets, 2)).toBeNull();
	});

	it("should respect the threshold strictly", () => {
		expect(getClosestMatch("verb", targets, 3)).toBeNull();
		expect(getClosestMatch("verb", targets, 4)).toBe("verbatim");
	});
});
