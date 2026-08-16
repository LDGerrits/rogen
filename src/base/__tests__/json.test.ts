import { safeStringify } from "../json.js";
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

describe("safeStringify", () => {
	it("should stringify standard objects and primitives normally", () => {
		const input = { name: "rogen", active: true, nodes: [1, 2, 3] };
		expect(safeStringify(input)).toBe(JSON.stringify(input));
	});

	it("should serialize BigInt safely without throwing an error", () => {
		const input = { id: 9007199254740991n };
		const result = safeStringify(input);

		expect(result).toBe('{"id":"[BigInt 9007199254740991]"}');
	});

	it("should handle circular references in objects gracefully", () => {
		const input: Record<string, unknown> = { name: "root" };
		input.self = input;

		const result = safeStringify(input);
		expect(result).toBe('{"name":"root","self":"[Circular]"}');
	});

	it("should handle circular references in arrays gracefully", () => {
		const input: unknown[] = [1, 2];
		input.push(input);

		const result = safeStringify(input);
		expect(result).toBe('[1,2,"[Circular]"]');
	});

	it("should mark duplicate references in the same tree as circular (known behavior)", () => {
		const duplicateNode = { val: 1 };
		const input = { a: duplicateNode, b: duplicateNode };

		const result = safeStringify(input);
		expect(result).toBe('{"a":{"val":1},"b":"[Circular]"}');
	});
});
