import { LegacyKeyRule } from "../rules/legacy-key.js";
import { UnknownKeyRule } from "../rules/unknown-key.js";
import { ConfigValidator } from "../validator.js";

describe("ConfigValidator", () => {
	it("should execute the first rule that can handle the key", () => {
		const validator = new ConfigValidator()
			.addRule(new LegacyKeyRule())
			.addRule(new UnknownKeyRule());

		const result = validator.validate({ keepRouteNames: true });

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.message).toContain('renamed to "verbatim"');
		}
	});

	it("should pass validation if all keys are valid", () => {
		const passingRule = {
			canHandle: () => true,
			validate: () => ({ isOk: () => true, isErr: () => false }) as any,
		};

		const validator = new ConfigValidator().addRule(passingRule);
		const result = validator.validate({ someKey: "value" });

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.unwrap().someKey).toBe("value");
		}
	});
});
