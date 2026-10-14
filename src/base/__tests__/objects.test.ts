import { getOwn, isObject, mergePatch, setOwn } from "../objects.js";

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

describe("mergePatch", () => {
	it("should merge objects by key, deeply", () => {
		expect(
			mergePatch({ a: { b: 1, c: 2 }, d: 3 }, { a: { c: 4 }, e: 5 })
		).toEqual({ a: { b: 1, c: 4 }, d: 3, e: 5 });
	});

	it("should replace a list instead of merging it", () => {
		expect(mergePatch({ a: [1, 2, 3] }, { a: [4] })).toEqual({ a: [4] });
	});

	it("should replace a value with one of another kind", () => {
		expect(mergePatch({ a: { b: 1 } }, { a: "text" })).toEqual({
			a: "text",
		});
		expect(mergePatch({ a: "text" }, { a: { b: 1 } })).toEqual({
			a: { b: 1 },
		});
	});

	it("should remove a key the patch sets to null, at any depth", () => {
		expect(
			mergePatch({ a: 1, b: { c: 2, d: 3 } }, { a: null, b: { c: null } })
		).toEqual({ b: { d: 3 } });
	});

	it("should ignore a null for a key the base lacks", () => {
		expect(mergePatch({ a: 1 }, { b: null, c: { d: null } })).toEqual({
			a: 1,
			c: {},
		});
	});

	it("should leave both inputs alone", () => {
		const base = { a: { b: 1 } };
		const patch = { a: { c: 2 } };

		mergePatch(base, patch);

		expect(base).toEqual({ a: { b: 1 } });
		expect(patch).toEqual({ a: { c: 2 } });
	});

	it("should keep a key named like a prototype as data", () => {
		const patch = JSON.parse('{"__proto__": {"x": 1}}');

		const merged = mergePatch({}, patch);

		expect(Object.keys(merged)).toEqual(["__proto__"]);
		expect(merged.x).toBeUndefined();
		expect(({} as Record<string, unknown>).x).toBeUndefined();
	});
});
