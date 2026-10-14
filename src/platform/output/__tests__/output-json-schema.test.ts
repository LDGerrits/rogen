import Ajv from "ajv";
import { OutputShape } from "../output-shape.js";
import { outputJsonSchema } from "./output-json-schema.js";

const S = OutputShape;

function validator(...shapes: OutputShape[]) {
	return new Ajv.default({ strict: true }).compile(outputJsonSchema(shapes));
}

describe("outputJsonSchema", () => {
	it("should accept a document that has the declared keys and refuse one that has another", () => {
		const check = validator(
			S.object({ a: S.string, b: S.optional(S.integer) })
		);

		expect(check({ a: "x" })).toBe(true);
		expect(check({ a: "x", b: 1 })).toBe(true);
		expect(check({ b: 1 })).toBe(false);
		expect(check({ a: "x", c: 1 })).toBe(false);
		expect(check({ a: "x", b: 1.5 })).toBe(false);
	});

	it("should accept null only where it is declared", () => {
		const check = validator(
			S.object({ a: S.nullable(S.string), b: S.string })
		);

		expect(check({ a: null, b: "x" })).toBe(true);
		expect(check({ a: "x", b: null })).toBe(false);
	});

	it("should hold the values of an enum and of a record", () => {
		const check = validator(
			S.object({
				outcome: S.enum("wrote", "unchanged"),
				by: S.record(S.integer),
			})
		);

		expect(check({ outcome: "wrote", by: { a: 1 } })).toBe(true);
		expect(check({ outcome: "failed", by: {} })).toBe(false);
		expect(check({ outcome: "wrote", by: { a: "1" } })).toBe(false);
	});

	it("should resolve a named shape wherever it is used, across the shapes given", () => {
		const entry = S.named("Entry", S.object({ file: S.string }));
		const check = validator(
			S.object({ entries: S.array(entry) }),
			S.object({ entry })
		);

		expect(check({ entries: [{ file: "a" }] })).toBe(true);
		expect(check({ entry: { file: "a" } })).toBe(true);
		expect(check({ entry: { file: 1 } })).toBe(false);
	});
});
