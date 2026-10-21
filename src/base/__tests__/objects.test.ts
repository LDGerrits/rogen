import { getOwn, isObject, isSameJson, setOwn } from "../objects.js";

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

describe("isSameJson", () => {
	it("compares by structure, whatever the prototypes", () => {
		const bare = Object.assign(Object.create(null), { a: [1, { b: 2 }] });

		expect(isSameJson(bare, { a: [1, { b: 2 }] })).toBe(true);
	});

	it("tells values, keys, lengths and kinds apart", () => {
		expect(isSameJson({ a: 1 }, { a: 2 })).toBe(false);
		expect(isSameJson({ a: 1 }, { b: 1 })).toBe(false);
		expect(isSameJson({ a: 1 }, { a: 1, b: 1 })).toBe(false);
		expect(isSameJson([1], [1, 2])).toBe(false);
		expect(isSameJson([], {})).toBe(false);
		expect(isSameJson(null, {})).toBe(false);
	});
});
