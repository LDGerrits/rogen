import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { LegacyConfig } from "../legacy-config.js";

describe("LegacyConfig", () => {
	describe("detects", () => {
		it("should recognise the keys only a v1 config has", () => {
			for (const key of ["source", "aliases"])
				expect(LegacyConfig.detects({ [key]: [] })).toBe(true);
		});

		it("should recognise a mode by its output or build", () => {
			expect(LegacyConfig.detects({ luau: { output: "a.json" } })).toBe(
				true
			);
			expect(LegacyConfig.detects({ ts: { build: "src" } })).toBe(true);
		});

		it("should not recognise a v2 config", () => {
			expect(
				LegacyConfig.detects({
					sourcePaths: ["src"],
					routes: { server: "ServerScriptService" },
					globIgnorePaths: ["**/*.spec.luau"],
					tree: { $className: "DataModel" },
				})
			).toBe(false);
		});

		it("should not take a route, a tree node or a project named build or output for a Rogen 1 mode", () => {
			for (const key of ["routes", "tree", "projects"])
				expect(
					LegacyConfig.detects({
						sourcePaths: ["src"],
						[key]: { build: "ServerStorage", output: "Workspace" },
					})
				).toBe(false);
		});

		it("should not recognise what isn't an object", () => {
			for (const value of [undefined, null, "source", 3, ["source"]])
				expect(LegacyConfig.detects(value)).toBe(false);
		});
	});

	describe("check", () => {
		it("should point to the migration page for a v1 config", () => {
			const [hint, ...others] = LegacyConfig.check({
				file: "/repo/.rogen.json",
				value: { source: ["src"] },
			});

			expect(others).toEqual([]);
			expect(hint).toMatchObject({
				severity: DiagnosticSeverity.Error,
				code: "legacy.config",
				resource: "/repo/.rogen.json",
			});
			expect(hint.message).toContain(LegacyConfig.MIGRATION_URL);
		});

		it("should say nothing about any other file", () => {
			expect(
				LegacyConfig.check({ file: "/repo/a.rogen.json", value: {} })
			).toEqual([]);
			expect(
				LegacyConfig.check({
					file: "/repo/a.rogen.json",
					value: undefined,
				})
			).toEqual([]);
		});
	});
});
