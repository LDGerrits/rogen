import { ConfigSchema } from "../schema.js";

describe("ConfigSchema", () => {
	it("should populate default values when parsing an empty object", () => {
		const result = ConfigSchema.safeParse({});

		expect(result.success).toBe(true);
		expect(result.data?.source).toEqual(["src"]);
		expect(result.data?.verbatim).toBe(false);
		expect(result.data?.casing).toBe("camelCase");
		expect(result.data?.aliases).toEqual({});
		expect(result.data?.globIgnorePaths).toEqual([]);
	});

	it("should transform a string source into an array", () => {
		const result = ConfigSchema.safeParse({ source: "lib" });

		expect(result.success).toBe(true);
		expect(result.data?.source).toEqual(["lib"]);
	});

	it("should normalize shorthand casing string values", () => {
		const result1 = ConfigSchema.safeParse({ casing: "pascal" });
		const result2 = ConfigSchema.safeParse({ casing: "camel" });

		expect(result1.success).toBe(true);
		expect(result2.success).toBe(true);

		expect(result1.data?.casing).toBe("PascalCase");
		expect(result2.data?.casing).toBe("camelCase");
	});

	it("should block typos by pushing them to the catchall (which expects a Mode object)", () => {
		const result = ConfigSchema.safeParse({ sourc: "lib" });

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe(
			'Custom mode "sourc" is missing a valid "output" or "build" string.'
		);
		expect(result.error?.issues[0]?.path).toEqual(["sourc"]);
	});

	it("should accept valid custom modes", () => {
		const result = ConfigSchema.safeParse({
			lute: { build: "dist", output: "lute.json" },
		});

		expect(result.success).toBe(true);

		const mode = result.data?.lute as
			| { build: string; output: string }
			| undefined;
		expect(mode?.build).toBe("dist");
		expect(mode?.output).toBe("lute.json");
	});

	it("should reject custom modes missing required fields", () => {
		const result = ConfigSchema.safeParse({
			lute: { build: "dist" },
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain(
			'Custom mode "lute" is missing a valid "output" or "build" string.'
		);
		expect(result.error?.issues[0]?.path).toEqual(["lute"]);
	});

	it("should inject custom issue messages for legacy keys", () => {
		const result = ConfigSchema.safeParse({ keepRouteNames: true });

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain(
			'renamed to "verbatim"'
		);
		expect(result.error?.issues[0]?.path).toEqual(["keepRouteNames"]);
	});
});
