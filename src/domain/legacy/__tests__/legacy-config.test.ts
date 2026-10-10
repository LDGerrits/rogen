import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { LegacyConfig } from "../legacy-config.js";

describe("LegacyConfig", () => {
	describe("detects", () => {
		it("should recognise the keys only a v1 config has", () => {
			for (const key of ["source", "aliases", "globIgnorePaths"])
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
					rootDirs: ["src"],
					routes: { server: "ServerScriptService" },
					variants: { mock: true },
					template: "base.project.json",
				})
			).toBe(false);
		});

		it("should not take a route, variant or mode named build or output for a Rogen 1 mode", () => {
			for (const key of ["routes", "variants", "modes"])
				expect(
					LegacyConfig.detects({
						rootDirs: ["src"],
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
		it("should hint at the migration page for a v1 config", () => {
			const [hint, ...others] = LegacyConfig.check({
				file: "/repo/.rogen.json",
				value: { source: ["src"] },
			});

			expect(others).toEqual([]);
			expect(hint).toMatchObject({
				severity: DiagnosticSeverity.Warning,
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
