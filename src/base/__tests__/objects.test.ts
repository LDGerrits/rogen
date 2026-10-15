import { getOwn, isObject, mergeByKey, setOwn } from "../objects.js";

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

describe("keys named like a prototype", () => {
	it("should set and read back an own property under the name", () => {
		const target: Record<string, number> = {};

		expect(getOwn(target, "__proto__")).toBeUndefined();
		setOwn(target, "__proto__", 1);

		expect(getOwn(target, "__proto__")).toBe(1);
		expect(Object.keys(target)).toEqual(["__proto__"]);
	});
});

describe("mergeByKey", () => {
	it("should merge objects by key, deeply", () => {
		expect(
			mergeByKey({ a: { b: 1, c: 2 }, d: 3 }, { a: { c: 4 }, e: 5 })
		).toEqual({ a: { b: 1, c: 4 }, d: 3, e: 5 });
	});

	it("should replace a list instead of merging it", () => {
		expect(mergeByKey({ a: [1, 2, 3] }, { a: [4] })).toEqual({ a: [4] });
	});

	it("should replace a value with one of another kind", () => {
		expect(mergeByKey({ a: { b: 1 } }, { a: "text" })).toEqual({
			a: "text",
		});
		expect(mergeByKey({ a: "text" }, { a: { b: 1 } })).toEqual({
			a: { b: 1 },
		});
	});

	it("should leave both inputs alone", () => {
		const base = { a: { b: 1 } };
		const changes = { a: { c: 2 } };

		mergeByKey(base, changes);

		expect(base).toEqual({ a: { b: 1 } });
		expect(changes).toEqual({ a: { c: 2 } });
	});

	it("should keep a key named like a prototype as data", () => {
		const changes = JSON.parse('{"__proto__": {"x": 1}}');

		const merged = mergeByKey({}, changes);

		expect(Object.keys(merged)).toEqual(["__proto__"]);
		expect(merged.x).toBeUndefined();
		expect(({} as Record<string, unknown>).x).toBeUndefined();
	});
});
