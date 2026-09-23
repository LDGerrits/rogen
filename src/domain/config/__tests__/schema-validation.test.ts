import { parseJsonc } from "../../../base/jsonc.js";
import { JSONSchema } from "../../../base/json-schema.js";
import { validateNode } from "../schema-validation.js";

const schema: JSONSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		build: {
			type: "object",
			additionalProperties: false,
			properties: { out: { type: "string" } },
		},
		list: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: { name: { type: "string" } },
			},
		},
	},
};

function validate(text: string) {
	const { root } = parseJsonc(text);
	return validateNode(root!, schema, "a.json").map((d) => [
		d.message,
		d.line,
		d.column,
	]);
}

describe("domain/config/schema-validation", () => {
	describe("validateNode", () => {
		it("should accept a document that matches the schema", () => {
			expect(validate('{ "build": { "out": "x" } }')).toEqual([]);
		});

		it("should reject an unknown field in a nested object", () => {
			expect(validate('{ "build": { "oot": "x" } }')).toEqual([
				['unknown field "build.oot".', 1, 14],
			]);
		});

		it("should reject an unknown field inside an array item", () => {
			expect(
				validate('{ "list": [{ "name": "a" }, { "nam": "b" }] }')
			).toEqual([['unknown field "list[1].nam".', 1, 31]]);
		});

		it("should report every problem, not only the first", () => {
			expect(validate('{ "a": 1, "build": { "b": 2 } }')).toHaveLength(2);
		});
	});
});
