import { mergeDeep, isObject } from "../object.js";

describe("isObject", () => {
	it("identifies plain objects", () => {
		expect(isObject({})).toBe(true);
		expect(isObject({ a: 1 })).toBe(true);
	});

	it("rejects non-objects", () => {
		expect(isObject([])).toBe(false);
		expect(isObject(null)).toBe(false);
		expect(isObject(/regex/)).toBe(false);
		expect(isObject(new Date())).toBe(false);
	});
});

describe("mergeDeep", () => {
	it("should merge two flat objects", () => {
		const obj1 = { a: 1, b: 2 };
		const obj2 = { b: 3, c: 4 };
		const result = mergeDeep(obj1, obj2);

		expect(result).toEqual({ a: 1, b: 3, c: 4 });
	});

	it("should deeply merge nested objects", () => {
		const obj1 = {
			settings: { theme: "dark", plugins: { a: true } },
		};
		const obj2 = {
			settings: { plugins: { b: true }, port: 8080 },
		};
		const result = mergeDeep(obj1, obj2);

		expect(result).toEqual({
			settings: {
				theme: "dark",
				plugins: { a: true, b: true },
				port: 8080,
			},
		});
	});

	it("should completely overwrite arrays instead of merging them", () => {
		const obj1 = { tags: ["a", "b"] };
		const obj2 = { tags: ["c"] };
		const result = mergeDeep(obj1, obj2);

		expect(result).toEqual({ tags: ["c"] });
	});

	it("should overwrite primitives with objects and vice-versa", () => {
		const obj1 = { data: "string" };
		const obj2 = { data: { nested: true } };

		const result1 = mergeDeep(obj1, obj2);
		expect(result1).toEqual({ data: { nested: true } });

		const result2 = mergeDeep(obj2, { data: "overwritten" });
		expect(result2).toEqual({ data: "overwritten" });
	});

	it("should handle multiple objects in sequence", () => {
		const defaults = { host: "localhost", port: 80, debug: false };
		const fileConfig = { port: 8080 };
		const cliFlags = { debug: true, verbose: true };

		const result = mergeDeep(defaults, fileConfig, cliFlags);

		expect(result).toEqual({
			host: "localhost",
			port: 8080,
			debug: true,
			verbose: true,
		});
	});

	it("should ignore null, undefined, or non-object arguments in the merge chain", () => {
		const obj1 = { a: 1 };
		const result = mergeDeep(obj1, null, undefined, { b: 2 }, "string");

		expect(result).toEqual({ a: 1, b: 2 });
	});

	it("should not mutate the original objects", () => {
		const obj1 = { nested: { a: 1 } };
		const obj2 = { nested: { b: 2 } };

		mergeDeep(obj1, obj2);

		expect(obj1).toEqual({ nested: { a: 1 } });
		expect(obj2).toEqual({ nested: { b: 2 } });
	});
});
