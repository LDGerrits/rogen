import { JSONSchema } from "../../../base/json-schema.js";
import { JsoncDocumentReader } from "../jsonc-document.js";

const FILE = "/repo/a.json";

const schema: JSONSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		name: { type: "string" },
		flags: { type: "object", additionalProperties: { type: "boolean" } },
		list: { type: "array", items: { type: "string" } },
	},
};

describe("platform/jsonc/jsonc-document", () => {
	describe("JsoncDocumentReader", () => {
		const reader = new JsoncDocumentReader({
			codePrefix: "thing",
			noun: "a thing",
		});
		const read = (text: string, against = schema) =>
			reader.read(text, FILE, against);
		const failures = (text: string) => {
			const result = read(text);
			if (result.isOk()) throw new Error("expected the read to fail");
			return result.error;
		};

		describe("read", () => {
			it("should return the root and value of a document that fits the schema", () => {
				const document = read('{ "name": "a" } // note').unwrap();

				expect(document.value).toEqual({ name: "a" });
				expect(document.root.properties[0].name).toBe("name");
			});

			it("should name syntax errors after the kind of file", () => {
				const diagnostics = failures('{ "name": }');

				expect(diagnostics[0]).toMatchObject({
					code: "thing.invalidSyntax",
					resource: FILE,
				});
				expect(diagnostics[0].position).toBeDefined();
			});

			it("should say what the kind of file must be when the root isn't an object", () => {
				const [diagnostic] = failures("[]");

				expect(diagnostic).toMatchObject({
					code: "thing.notAnObject",
					message: "a thing must be a JSON object.",
				});
			});

			it("should report a value of the wrong type at its path", () => {
				const [diagnostic] = failures('{ "flags": { "a": 1 } }');

				expect(diagnostic).toMatchObject({
					code: "thing.wrongType",
					message: '"flags.a": expected a boolean, found a number.',
					position: { line: 1, column: 19 },
				});
			});

			it("should check every item of an array", () => {
				const diagnostics = failures('{ "list": ["a", 1, true] }');

				expect(diagnostics.map(({ message }) => message)).toEqual([
					'"list[1]": expected a string, found a number.',
					'"list[2]": expected a string, found a boolean.',
				]);
			});

			it("should reject a field the schema doesn't list when it forbids others", () => {
				const [diagnostic] = failures('{ "other": 1 }');

				expect(diagnostic).toMatchObject({
					code: "thing.unknownField",
					message: 'unknown field "other".',
				});
			});

			it("should let fields through when the schema doesn't forbid others", () => {
				const open: JSONSchema = {
					type: "object",
					properties: { name: { type: "string" } },
				};

				expect(read('{ "other": 1 }', open).isOk()).toBe(true);
			});
		});
	});
});
