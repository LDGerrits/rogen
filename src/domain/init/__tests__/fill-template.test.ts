import { fillTemplate, placeholdersIn } from "../fill-template.js";

describe("fillTemplate", () => {
	it("should replace each placeholder", () => {
		expect(
			fillTemplate("# {{name}} in {{source}} and {{name}}", {
				name: "game",
				source: "src",
			})
		).toBe("# game in src and game");
	});

	it("should leave single braces and interpolations alone", () => {
		expect(fillTemplate("`Hello, {who}!` ${who}", {})).toBe(
			"`Hello, {who}!` ${who}"
		);
	});

	it("should refuse a placeholder it has no value for", () => {
		expect(() => fillTemplate("{{place}}", { name: "game" })).toThrow(
			"{{place}}"
		);
	});

	it("should refuse a placeholder init doesn't know", () => {
		expect(() => fillTemplate("{{title}}", {})).toThrow("{{title}}");
	});
});

describe("placeholdersIn", () => {
	it("should list the names between double braces", () => {
		expect(placeholdersIn("{{name}} {who} {{place}}")).toEqual([
			"name",
			"place",
		]);
	});
});
