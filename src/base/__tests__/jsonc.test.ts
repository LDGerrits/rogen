import { parse, parseJsonc, parseJsoncSpans, setJsoncValue } from "../jsonc.js";

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

describe("setJsoncValue", () => {
	const TEXT = [
		"{",
		'  "tree": {',
		'    "Lighting": { "$properties": { "ClockTime": 14 } },',
		'    "Folder": {',
		'      "$className": "Folder"',
		"    }",
		"  }",
		"}",
	].join("\n");

	it("should keep an object written on one line on one line when a value in it changes", () => {
		const text = setJsoncValue(TEXT, ["tree", "Lighting", "$properties"], {
			ClockTime: 6,
		});

		expect(text).toBe(TEXT.replace('"ClockTime": 14', '"ClockTime": 6'));
	});

	it("should add a key to an object written on one line on that line", () => {
		const text = setJsoncValue(
			TEXT.replace("} },", "} }, // the sky"),
			["tree", "Lighting", "$attributes"],
			{ Sun: { Float32: 1 }, Tint: [1, 0.5, 0] }
		);

		expect(text).toContain(
			'    "Lighting": { "$properties": { "ClockTime": 14 }, "$attributes": { "Sun": { "Float32": 1 }, "Tint": [1, 0.5, 0] } }, // the sky\n'
		);
	});

	it("should keep nested objects written on one line on one line", () => {
		const text = setJsoncValue(
			TEXT.replace(
				'"Lighting": { "$properties": { "ClockTime": 14 } }',
				'"Lighting": { "Sky": { "$properties": { "StarCount": 3 } } }'
			),
			["tree", "Lighting", "Sky", "$properties"],
			{ StarCount: 5, CelestialBodiesShown: false }
		);

		expect(text).toContain(
			'    "Lighting": { "Sky": { "$properties": { "StarCount": 5, "CelestialBodiesShown": false } } },\n'
		);
	});

	it("should remove a key from an object written on one line", () => {
		const text = setJsoncValue(
			TEXT.replace(
				'{ "$properties"',
				'{ "$className": "Lighting", "$properties"'
			),
			["tree", "Lighting", "$properties"],
			undefined
		);

		expect(text).toContain(
			'    "Lighting": { "$className": "Lighting" },\n'
		);
	});

	it("should write a key added to an object written on several lines on lines of its own", () => {
		const text = setJsoncValue(TEXT, ["tree", "Folder", "$attributes"], {
			Level: 1,
		});

		expect(text).toBe(
			TEXT.replace(
				'      "$className": "Folder"\n',
				[
					'      "$className": "Folder",',
					'      "$attributes": {',
					'        "Level": 1',
					"      }",
					"",
				].join("\n")
			)
		);
	});
});
