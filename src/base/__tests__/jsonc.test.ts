import { parse } from "../jsonc.js";

describe("parse", () => {
	it("should return the value of a plain JSON document", () => {
		expect(parse('{"a": [1, true, null]}').unwrap()).toEqual({
			a: [1, true, null],
		});
	});

	it("should accept comments and trailing commas", () => {
		const text = `{
			// the output directory
			"compilerOptions": { "outDir": "out", /* inline */ },
		}`;

		expect(parse(text).unwrap()).toEqual({
			compilerOptions: { outDir: "out" },
		});
	});

	it("should ignore a byte order mark", () => {
		expect(parse('﻿{"a": 1}').unwrap()).toEqual({ a: 1 });
	});

	it("should return the value of a non-object document", () => {
		expect(parse("[1, 2]").unwrap()).toEqual([1, 2]);
		expect(parse('"text"').unwrap()).toBe("text");
	});

	it("should return an error naming the position of a syntax error", () => {
		const result = parse('{\n  "a": \n}');

		expect(result.isErr()).toBe(true);
		expect(result.unwrapOr(undefined)).toBeUndefined();
		expect(String((result as { error: Error }).error.message)).toMatch(
			/3:1.*expected a value/
		);
	});

	it("should return an error for an empty document", () => {
		expect(parse("").isErr()).toBe(true);
		expect(parse("  // only a comment").isErr()).toBe(true);
	});
});
