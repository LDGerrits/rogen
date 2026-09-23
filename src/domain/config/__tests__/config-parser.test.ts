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
			expect(result.unwrap()).toEqual({
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
				code: "RG1001",
				severity: "error",
				file: "lobby.rogen.json",
				line: 3,
				column: 2,
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
					code: "RG1004",
					severity: "error",
					message: 'unknown field "bogus".',
					file: "lobby.rogen.json",
					line: 3,
					column: 2,
				},
			]);
		});

		it("should suggest the nearest field name for a near miss", () => {
			const result = parseConfig(
				'{ "rootDir": ["src"] }',
				"a.rogen.json"
			);

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) return;
			expect(result.error[0].message).toBe(
				'unknown field "rootDir". Did you mean "rootDirs"?'
			);
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
			expect(result.error.map((d) => d.column)).toEqual([3, 11]);
		});

		it.each(["", "[]", "null", "42", '"text"'])(
			"should reject %j as a config that is not an object",
			(text) => {
				const result = parseConfig(text, "a.rogen.json");

				expect(result.isErr()).toBe(true);
				if (!result.isErr()) return;
				expect(result.error).toHaveLength(1);
				expect(result.error[0]).toMatchObject({
					code: "RG1002",
					message: "a config must be a JSON object.",
					file: "a.rogen.json",
					line: 1,
					column: 1,
				});
			}
		);

		it("should describe a syntax error in words", () => {
			const result = parseConfig('{ "rootDirs": ["src"', "a.rogen.json");

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) return;
			expect(result.error.map((d) => d.message)).toContain(
				"invalid JSONC: expected ']'."
			);
		});

		it("should not throw on malformed input", () => {
			expect(() =>
				parseConfig("{ ] \u0000 //", "a.rogen.json")
			).not.toThrow();
		});
	});
});
