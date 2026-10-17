import {
	insertJsoncItem,
	parse,
	parseJsonc,
	parseJsoncSpans,
} from "../jsonc.js";

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

describe("parseJsonc", () => {
	it("should report one error for every object still open at the end", () => {
		const { errors } = parseJsonc('{ "a": { "b": 1');

		expect(errors).toEqual([
			{ message: "expected '}'", line: 1, column: 16 },
		]);
	});

	it("should keep different errors at one position", () => {
		const { errors } = parseJsonc('{ "a": [ { "b": 1');

		expect(errors.map((error) => error.message)).toEqual([
			"expected '}'",
			"expected ']'",
		]);
	});

	it("should place nodes by line and column across line breaks", () => {
		const { root } = parseJsonc('{\r\n  "a": 1,\r\n  "b": [true]\n}');

		expect(root).toMatchObject({
			line: 1,
			column: 1,
			properties: [
				{
					name: "a",
					line: 2,
					column: 3,
					value: { line: 2, column: 8 },
				},
				{
					name: "b",
					line: 3,
					column: 3,
					value: {
						line: 3,
						column: 8,
						items: [{ line: 3, column: 9 }],
					},
				},
			],
		});
	});
});

describe("insertJsoncItem", () => {
	it("should insert before the index, keeping the comments", () => {
		const text = '{\n\t// order\n\t"a": [1, 3]\n}\n';

		const edited = insertJsoncItem(text, ["a"], 1, 2);

		expect(edited).toContain("// order");
		expect(parseJsonc(edited).value).toEqual({ a: [1, 2, 3] });
	});

	it("should add last when the array is shorter than the index", () => {
		expect(
			parseJsonc(insertJsoncItem('{"a": [1]}', ["a"], 5, 2)).value
		).toEqual({ a: [1, 2] });
	});
});

describe("parseJsoncSpans", () => {
	it("should say where each value is, so it can be copied as written", () => {
		const text = '{"a": { "b": 1, }, "c": 2}';

		const parsed = parseJsoncSpans(text)!;
		const [a] = parsed.root.properties!;

		expect(parsed.text.slice(a.value.start, a.value.end)).toBe(
			'{ "b": 1, }'
		);
		expect(a.value.value).toEqual({ b: 1 });
	});

	it("should leave out a byte order mark, which the offsets don't count", () => {
		const parsed = parseJsoncSpans("\ufeff{}")!;

		expect(parsed.text).toBe("{}");
	});

	it("should be undefined for a document with an error", () => {
		expect(parseJsoncSpans("{")).toBeUndefined();
	});
});
