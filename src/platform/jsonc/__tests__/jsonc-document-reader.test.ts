import { JsonStructure } from "../../../base/json-structure.js";
import { JsoncDocumentReader } from "../jsonc-document-reader.js";

const FILE = "/repo/a.json";

const structure: JsonStructure = {
	type: "object",
	additionalProperties: false,
	properties: {
		name: { type: "string" },
		flags: { type: "object", additionalProperties: { type: "boolean" } },
		list: { type: "array", items: { type: "string" } },
	},
};

describe("platform/jsonc/jsonc-document-reader", () => {
	describe("JsoncDocumentReader", () => {
		const reader = new JsoncDocumentReader({
			codePrefix: "thing",
			noun: "a thing",
		});
		const read = (text: string, against = structure) =>
			reader.read(text, FILE, against);
		const failures = (text: string) => {
			const result = read(text);
			if (result.isOk()) throw new Error("expected the read to fail");
			return result.error;
		};

		describe("read", () => {
			it("should return the root and value of a document that fits the structure", () => {
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

			it("should reject a field the structure doesn't list when it forbids others", () => {
				const [diagnostic] = failures('{ "other": 1 }');

				expect(diagnostic).toMatchObject({
					code: "thing.unknownField",
					message: 'unknown field "other".',
				});
			});

			it("should suggest the listed field a misspelled one is closest to", () => {
				const [diagnostic] = failures('{ "nmae": "a" }');

				expect(diagnostic.message).toBe(
					'unknown field "nmae". Did you mean "name"?'
				);
			});

			it("should not suggest a field the object already has", () => {
				const [diagnostic] = failures('{ "name": "a", "nmae": "b" }');

				expect(diagnostic.message).toBe('unknown field "nmae".');
			});

			it("should suggest a nested field at its path", () => {
				const nested: JsonStructure = {
					type: "object",
					properties: { inner: structure },
				};
				const result = read('{ "inner": { "lsit": [] } }', nested);

				expect(result.isErr() && result.error[0].message).toBe(
					'unknown field "inner.lsit". Did you mean "inner.list"?'
				);
			});

			it("should not mistake an inherited property name for a listed field", () => {
				expect(read('{ "constructor": 1 }').isOk()).toBe(false);
				expect(
					read('{ "constructor": 1 }', {
						type: "object",
						properties: { name: { type: "string" } },
					}).isOk()
				).toBe(true);
			});

			it("should report a number that is not whole or is out of range, and accept the bounds", () => {
				const bounded: JsonStructure = {
					type: "object",
					properties: {
						port: { type: "number", whole: { max: 10 } },
					},
				};
				const messages = (text: string) => {
					const result = read(text, bounded);
					return result.isErr()
						? result.error.map(({ message }) => message)
						: [];
				};

				expect(messages('{ "port": 11 }')).toEqual([
					'"port": expected a whole number from 0 to 10, found 11.',
				]);
				expect(messages('{ "port": -1 }')).toHaveLength(1);
				expect(messages('{ "port": 1.5 }')).toHaveLength(1);
				expect(messages('{ "port": 1.0 }')).toHaveLength(1);
				expect(messages('{ "port": 1e1 }')).toHaveLength(1);
				expect(messages('{ "port": 0 }')).toEqual([]);
				expect(messages('{ "port": 10 }')).toEqual([]);
			});

			it("should report a string that is no IP address, with the hint of the structure", () => {
				const addressed: JsonStructure = {
					type: "object",
					properties: {
						host: {
							type: "string",
							ipAddress: true,
							hint: "Use another key for names.",
						},
					},
				};

				const bad = read('{ "host": "example.com" }', addressed);
				expect(bad.isErr() && bad.error[0].message).toBe(
					'"host": expected an IP address such as 127.0.0.1, found "example.com". Use another key for names.'
				);
				expect(read('{ "host": "::1" }', addressed).isOk()).toBe(true);
			});

			it("should let fields through when the structure doesn't forbid others", () => {
				const open: JsonStructure = {
					type: "object",
					properties: { name: { type: "string" } },
				};

				expect(read('{ "other": 1 }', open).isOk()).toBe(true);
			});
		});
	});
});
