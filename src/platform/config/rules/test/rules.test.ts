import { CustomModeRule } from "../custom-mode.js";
import { EnforceTypeRule } from "../enforce-type.js";
import { LegacyKeyRule } from "../legacy-key.js";
import { UnknownKeyRule } from "../unknown-key.js";

describe("Config Rules", () => {
	describe("LegacyKeyRule", () => {
		const rule = new LegacyKeyRule();

		it("should handle legacy keys like keepRouteNames", () => {
			expect(rule.canHandle("keepRouteNames", true)).toBe(true);
			expect(rule.canHandle("source", "src")).toBe(false);
		});

		it("should return an error instructing the user to update their config", () => {
			const result = rule.validate("keepRouteNames", true);
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.message).toContain('renamed to "verbatim"');
			}
		});
	});

	describe("CustomModeRule", () => {
		const rule = new CustomModeRule();

		it("should handle unknown objects as potential custom modes", () => {
			expect(rule.canHandle("myCustomMode", {})).toBe(true);
			expect(rule.canHandle("source", {})).toBe(false);
			expect(rule.canHandle("invalidMode", "string")).toBe(false);
		});

		it("should validate a correct custom mode", () => {
			const result = rule.validate("lute", {
				output: "a.json",
				build: "b",
			});
			expect(result.isOk()).toBe(true);
		});

		it("should return an error for a broken custom mode", () => {
			const result = rule.validate("lute", { output: "a.json" });
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.message).toContain("missing a valid");
			}
		});
	});

	describe("EnforceTypeRule", () => {
		const rule = new EnforceTypeRule();

		it("should handle known config keys", () => {
			expect(rule.canHandle("source", "src")).toBe(true);
			expect(rule.canHandle("unknownKey", "src")).toBe(false);
		});

		it("should validate correct types", () => {
			expect(rule.validate("source", ["src"]).isOk()).toBe(true);
			expect(rule.validate("verbatim", true).isOk()).toBe(true);
			expect(rule.validate("casing", "PascalCase").isOk()).toBe(true);
		});

		it("should reject incorrect types", () => {
			expect(rule.validate("source", true).isErr()).toBe(true);
			expect(rule.validate("verbatim", "true").isErr()).toBe(true);
			expect(rule.validate("casing", "snake_case").isErr()).toBe(true);
			expect(rule.validate("globIgnorePaths", "string").isErr()).toBe(
				true
			);
			expect(rule.validate("template", { bad: "tree" }).isErr()).toBe(
				true
			);
		});
	});

	describe("UnknownKeyRule", () => {
		const rule = new UnknownKeyRule();

		it("should act as a catch-all fallback", () => {
			expect(rule.canHandle("anything", null)).toBe(true);
		});

		it("should suggest typos", () => {
			const result = rule.validate("templat", null);
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.message).toContain(
					'Did you mean "template"?'
				);
			}
		});
	});
});
