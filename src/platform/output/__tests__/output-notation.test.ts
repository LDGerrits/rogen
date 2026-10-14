import { OutputNotation } from "../output-notation.js";
import { OutputShape, namedShapes } from "../output-shape.js";

const S = OutputShape;

describe("OutputNotation", () => {
	it("should write each kind of shape compactly", () => {
		const shape = S.object({
			name: S.string,
			count: S.integer,
			ok: S.boolean,
			outcome: S.enum("wrote", "unchanged"),
			tags: S.array(S.string),
			by: S.record(S.integer),
			parent: S.nullable(S.string),
			note: S.optional(S.string),
		});

		expect(OutputNotation.of(shape)).toBe(
			'{name:string,count:int,ok:bool,outcome:"wrote"|"unchanged",tags:[string],by:{*:int},parent:string|null,note?:string}'
		);
	});

	it("should write a named shape as its name, and define it once", () => {
		const entry = S.named("Entry", S.object({ file: S.string }));
		const declaration = {
			document: S.object({ a: S.array(entry), b: entry }),
		};

		expect(OutputNotation.describe(declaration)).toEqual({
			document: "{a:[Entry],b:Entry}",
		});
		expect(OutputNotation.shapesOf(declaration)).toEqual({
			Entry: "{file:string}",
		});
	});

	it("should define the shapes inside a named shape too", () => {
		const inner = S.named("Inner", S.string);
		const outer = S.named("Outer", S.array(inner));

		expect(OutputNotation.shapesOf({ lines: outer })).toEqual({
			Outer: "[Inner]",
			Inner: "string",
		});
	});

	it("should describe the lines of a command that has them", () => {
		expect(
			OutputNotation.describe({
				document: S.string,
				lines: S.object({ a: S.boolean }),
			})
		).toEqual({ document: "string", lines: "{a:bool}" });
	});
});

describe("namedShapes", () => {
	it("should refuse two different shapes under one name", () => {
		const shape = S.union(S.named("A", S.string), S.named("A", S.integer));

		expect(() => namedShapes(shape)).toThrow(
			"Two different output shapes are named A."
		);
	});
});
