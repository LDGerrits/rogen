import { ConfigFileFailure, ConfigFileReader } from "../config-file.js";
import { JSONSchema } from "../../../base/json-schema.js";
import { Result, ResultError } from "../../../base/result.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";

const FILE = "/repo/a.json";

const SCHEMA: JSONSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		$schema: { type: "string" },
		name: { type: "string" },
		list: { type: "array", items: { type: "string" } },
		flags: {
			type: "object",
			additionalProperties: { type: "boolean" },
		},
		words: {
			type: "object",
			additionalProperties: { type: "string" },
		},
		build: {
			type: "object",
			additionalProperties: false,
			properties: { out: { type: "string" } },
		},
		entries: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: { name: { type: "string" } },
			},
		},
	},
};

describe("platform/config/config-file", () => {
	describe("ConfigFileReader", () => {
		let fs: MemoryFileSystemService;
		let reader: ConfigFileReader;

		beforeEach(async () => {
			fs = new MemoryFileSystemService();
			reader = new ConfigFileReader(fs, SCHEMA);
			await fs.createDirectory("/repo");
		});

		const read = async (text: string) => {
			await fs.writeFile(FILE, text);
			return reader.read(FILE);
		};

		const diagnosticsOf = (
			result: Result<unknown, ConfigFileFailure>
		): readonly Diagnostic[] =>
			(result as ResultError<ConfigFileFailure>).error.diagnostics;

		it("should parse comments and trailing commas", async () => {
			const result = await read(`{
	"list": ["a",],
	/* flags */
	"flags": { "on": true, },
}`);

			expect(result.unwrap().model.contents).toEqual({
				list: ["a"],
				flags: { on: true },
			});
		});

		it("should ignore a leading byte order mark", async () => {
			const result = await read('﻿{ "list": ["a"] }');

			expect(result.unwrap().model.contents).toEqual({ list: ["a"] });
		});

		it("should accept $schema", async () => {
			const result = await read('{ "$schema": "https://example.com" }');

			expect(result.isOk()).toBe(true);
		});

		it("should report a missing file as a diagnostic instead of throwing", async () => {
			const result = await reader.read("/repo/nope.json");

			expect(diagnosticsOf(result)).toMatchObject([
				{
					severity: DiagnosticSeverity.Error,
					code: "config.unreadable",
					resource: "/repo/nope.json",
					position: { line: 1, column: 1 },
				},
			]);
		});

		it("should say a missing file does not exist, and where it looked", async () => {
			const result = await reader.read("/repo/nope.json");

			expect(diagnosticsOf(result)[0].message).toBe(
				"the config does not exist (looked for /repo/nope.json)."
			);
			expect(
				(result as ResultError<ConfigFileFailure>).error.missing
			).toBe(true);
		});

		it("should give the reason, without a Node code, for a directory where a file is expected", async () => {
			await fs.createDirectory("/repo/dir.json");

			const result = await reader.read("/repo/dir.json");

			expect(diagnosticsOf(result)[0].message).toBe(
				"the config could not be read: illegal operation on a directory."
			);
			expect(
				(result as ResultError<ConfigFileFailure>).error
			).toMatchObject({ missing: false, kind: "unreadable" });
		});

		it("should tell a file it couldn't read from one that is wrong", async () => {
			const unreadable = await reader.read("/repo/nope.json");
			const invalid = await read("garbage");

			expect(
				(unreadable as ResultError<ConfigFileFailure>).error.kind
			).toBe("unreadable");
			expect((invalid as ResultError<ConfigFileFailure>).error.kind).toBe(
				"invalid"
			);
		});

		it("should report a syntax error with its file, line and column", async () => {
			const result = await read(`{
	"list": ["a"]
	"name": "x"
}`);

			expect(diagnosticsOf(result)[0]).toMatchObject({
				severity: DiagnosticSeverity.Error,
				code: "config.invalidSyntax",
				resource: FILE,
				position: { line: 3, column: 2 },
			});
		});

		it("should describe a syntax error in words", async () => {
			const result = await read('{ "list": ["a"');

			expect(diagnosticsOf(result).map((d) => d.message)).toContain(
				"invalid JSONC: expected ']'."
			);
		});

		it.each(["", "garbage", "[1,", "{ 1 }"])(
			"should report %j as a syntax error rather than a wrong root type",
			async (text) => {
				const result = await read(text);

				expect(
					diagnosticsOf(result).every(
						(d) => d.code === "config.invalidSyntax"
					)
				).toBe(true);
			}
		);

		it.each(["[]", "null", "42", '"text"'])(
			"should reject %j as a config that is not an object",
			async (text) => {
				const result = await read(text);

				expect(diagnosticsOf(result)).toMatchObject([
					{
						code: "config.notAnObject",
						resource: FILE,
						position: { line: 1, column: 1 },
					},
				]);
			}
		);

		it("should report a document nested too deeply instead of throwing", async () => {
			const result = await read("[".repeat(100000));

			expect(diagnosticsOf(result)[0].message).toBe(
				"invalid JSONC: the document is nested too deeply."
			);
		});

		it("should not throw on malformed input", async () => {
			await expect(read("{ ] \u0000 //")).resolves.toBeDefined();
		});

		it("should report an unknown field with its location", async () => {
			const result = await read(`{
	"list": ["a"],
	"bogus": true
}`);

			expect(diagnosticsOf(result)).toEqual([
				{
					severity: DiagnosticSeverity.Error,
					code: "config.unknownField",
					message: 'unknown field "bogus".',
					resource: FILE,
					position: { line: 3, column: 2 },
				},
			]);
		});

		it("should report every unknown field", async () => {
			const result = await read('{ "a": 1, "b": 2 }');

			expect(
				diagnosticsOf(result).map((d) => d.position?.column)
			).toEqual([3, 11]);
		});

		it("should report an unknown field in a nested object", async () => {
			const result = await read('{ "build": { "oot": "x" } }');

			expect(
				diagnosticsOf(result).map((d) => [
					d.message,
					d.position?.column,
				])
			).toEqual([
				['unknown field "build.oot". Did you mean "build.out"?', 14],
			]);
		});

		it("should report an unknown field inside an array item", async () => {
			const result = await read(
				'{ "entries": [{ "name": "a" }, { "nam": "b" }] }'
			);

			expect(
				diagnosticsOf(result).map((d) => [
					d.message,
					d.position?.column,
				])
			).toEqual([
				[
					'unknown field "entries[1].nam". Did you mean "entries[1].name"?',
					34,
				],
			]);
		});

		it("should reject a value of the wrong type", async () => {
			const result = await read('{ "list": "a" }');

			expect(diagnosticsOf(result)).toEqual([
				{
					severity: DiagnosticSeverity.Error,
					code: "config.wrongType",
					message: '"list": expected an array, found a string.',
					resource: FILE,
					position: { line: 1, column: 11 },
				},
			]);
		});

		it("should reject a wrongly typed array item", async () => {
			const result = await read('{ "list": ["a", 1] }');

			expect(
				diagnosticsOf(result).map((d) => [
					d.message,
					d.position?.column,
				])
			).toEqual([['"list[1]": expected a string, found a number.', 17]]);
		});

		it("should reject a wrongly typed value in a map", async () => {
			const result = await read('{ "flags": { "on": "yes" } }');

			expect(
				diagnosticsOf(result).map((d) => [
					d.message,
					d.position?.column,
				])
			).toEqual([
				['"flags.on": expected a boolean, found a string.', 20],
			]);
		});

		it("should reject null wherever it appears", async () => {
			const result = await read(
				'{ "name": null, "words": { "a": null } }'
			);

			expect(diagnosticsOf(result).map((d) => d.message)).toEqual([
				'"name": expected a string, found null.',
				'"words.a": expected a string, found null.',
			]);
		});

		describe("positionOf", () => {
			const text = `{
	"name": "x",
	"list": ["a", "b"],
	"words": { "k": "v" }
}`;

			it("should return the line and column of a value", async () => {
				const file = (await read(text)).unwrap();

				expect(file.positionOf("name")).toEqual({
					line: 2,
					column: 10,
				});
				expect(file.positionOf("words.k")).toEqual({
					line: 4,
					column: 18,
				});
			});

			it("should reach an array item by index", async () => {
				const file = (await read(text)).unwrap();

				expect(file.positionOf("list.1")).toEqual({
					line: 3,
					column: 16,
				});
			});

			it("should accept segments for a key containing a dot", async () => {
				const file = (
					await read('{ "words": { "a.b": "v" } }')
				).unwrap();

				expect(file.positionOf(["words", "a.b"])).toEqual({
					line: 1,
					column: 21,
				});
			});

			it("should return undefined for a section the file does not set", async () => {
				const file = (await read(text)).unwrap();

				expect(file.positionOf("flags")).toBeUndefined();
				expect(file.positionOf("name.deeper")).toBeUndefined();
			});
		});
	});
});
