import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import "../config.js";
import { parseConfig } from "../config-parser.js";

describe("domain/config/config-parser", () => {
	describe("parseConfig", () => {
		it("should parse comments and trailing commas", () => {
			const text = `{
	// where the code lives
	"rootDirs": ["src",],
	/* tags */
	"tags": { "mock": false, },
}`;

			const result = parseConfig(text, "lobby.rogen.json");

			expect(result.isOk()).toBe(true);
			expect(result.unwrap().config).toEqual({
				rootDirs: ["src"],
				tags: { mock: false },
			});
		});

		it("should report a syntax error with its file, line and column", () => {
			const text = `{
	"rootDirs": ["src"]
	"tags": {}
}`;

			const result = parseConfig(text, "lobby.rogen.json");

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) return;
			expect(result.error[0]).toMatchObject({
				severity: DiagnosticSeverity.Error,
				code: "config.invalidSyntax",
				resource: "lobby.rogen.json",
				position: { line: 3, column: 2 },
			});
		});

		it("should report an unknown field with its location", () => {
			const text = `{
	"rootDirs": ["src"],
	"bogus": true
}`;

			const result = parseConfig(text, "lobby.rogen.json");

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) return;
			expect(result.error).toEqual([
				{
					severity: DiagnosticSeverity.Error,
					code: "config.unknownField",
					message: 'unknown field "bogus".',
					resource: "lobby.rogen.json",
					position: { line: 3, column: 2 },
				},
			]);
		});

		it("should accept $schema", () => {
			const result = parseConfig(
				'{ "$schema": "https://example.com/rogen.json" }',
				"a.rogen.json"
			);

			expect(result.isOk()).toBe(true);
		});

		it("should report every unknown field", () => {
			const result = parseConfig('{ "a": 1, "b": 2 }', "a.rogen.json");

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) return;
			expect(result.error.map((d) => d.position?.column)).toEqual([
				3, 11,
			]);
		});

		it.each(["[]", "null", "42", '"text"'])(
			"should reject %j as a config that is not an object",
			(text) => {
				const result = parseConfig(text, "a.rogen.json");

				expect(result.isErr()).toBe(true);
				if (!result.isErr()) return;
				expect(result.error).toHaveLength(1);
				expect(result.error[0]).toMatchObject({
					code: "config.notAnObject",
					resource: "a.rogen.json",
					position: { line: 1, column: 1 },
				});
			}
		);

		it.each(["", "garbage", "[1,", "{ 1 }"])(
			"should report %j as a syntax error rather than a wrong root type",
			(text) => {
				const result = parseConfig(text, "a.rogen.json");

				expect(result.isErr()).toBe(true);
				if (!result.isErr()) return;
				expect(
					result.error.every((d) => d.code === "config.invalidSyntax")
				).toBe(true);
			}
		);

		it("should ignore a leading byte order mark", () => {
			const result = parseConfig(
				'\ufeff{ "rootDirs": ["src"] }',
				"a.rogen.json"
			);

			expect(result.unwrap().config).toEqual({ rootDirs: ["src"] });
		});

		it("should describe a syntax error in words", () => {
			const result = parseConfig('{ "rootDirs": ["src"', "a.rogen.json");

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) return;
			expect(result.error.map((d) => d.message)).toContain(
				"invalid JSONC: expected ']'."
			);
		});

		it("should report a document nested too deeply instead of throwing", () => {
			const result = parseConfig("[".repeat(100000), "a.rogen.json");

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) return;
			expect(result.error[0].message).toBe(
				"invalid JSONC: the document is nested too deeply."
			);
		});

		it("should not throw on malformed input", () => {
			expect(() =>
				parseConfig("{ ] \u0000 //", "a.rogen.json")
			).not.toThrow();
		});

		it("should reject a value of the wrong type at the root", () => {
			const result = parseConfig('{ "rootDirs": "src" }', "a.rogen.json");

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) return;
			expect(result.error).toEqual([
				{
					severity: DiagnosticSeverity.Error,
					code: "config.wrongType",
					message: '"rootDirs": expected an array, found a string.',
					resource: "a.rogen.json",
					position: { line: 1, column: 15 },
				},
			]);
		});

		it("should reject a wrongly typed array item", () => {
			const result = parseConfig(
				'{ "rootDirs": ["src", 1] }',
				"a.rogen.json"
			);

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) return;
			expect(
				result.error.map((d) => [d.message, d.position?.column])
			).toEqual([
				['"rootDirs[1]": expected a string, found a number.', 23],
			]);
		});

		it("should reject a wrongly typed value in a map", () => {
			const result = parseConfig(
				'{ "tags": { "mock": "yes" } }',
				"a.rogen.json"
			);

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) return;
			expect(
				result.error.map((d) => [d.message, d.position?.column])
			).toEqual([
				['"tags.mock": expected a boolean, found a string.', 21],
			]);
		});

		it("should reject null wherever it appears", () => {
			const result = parseConfig(
				'{ "syncDir": null, "routes": { "shared": null } }',
				"a.rogen.json"
			);

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) return;
			expect(result.error.map((d) => d.message)).toEqual([
				'"syncDir": expected a string, found null.',
				'"routes.shared": expected a string, found null.',
			]);
		});
	});
});
