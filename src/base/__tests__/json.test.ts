import { sortObject } from "../object.js";

describe("sortObject", () => {
	it("should sort object keys alphabetically and recursively", () => {
		const input = { z: 1, a: { y: 2, b: 3 } };
		const result = sortObject(input);

		expect(Object.keys(result)).toEqual(["a", "z"]);
		expect(Object.keys(result.a)).toEqual(["b", "y"]);
	});

	it("should leave arrays alone", () => {
		const input = { b: [2, 1], a: 1 };
		const result = sortObject(input);
		expect(result.b).toEqual([2, 1]);
	});
});
