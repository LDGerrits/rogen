import { ok } from "../../../base/result.js";
import { LegacyKeyRule } from "../rules/legacy-key.js";
import { IValidationRule } from "../rules/rule.js";
import { UnknownKeyRule } from "../rules/unknown-key.js";
import { ConfigValidator } from "../validator.js";

describe("ConfigValidator", () => {
	it("should execute the first rule that can handle the key", () => {
		const validator = new ConfigValidator()
			.addRule(new LegacyKeyRule())
			.addRule(new UnknownKeyRule());

		const result = validator.validate({ keepRouteNames: true });

		if (!result.isErr()) {
			throw new Error("Expected validation to return an error.");
		}

		expect(result.error.message).toContain('renamed to "verbatim"');
	});

	it("should pass validation if all keys are valid", () => {
		const passingRule: IValidationRule = {
			canHandle: () => true,
			validate: () => ok(undefined),
		};

		const validator = new ConfigValidator().addRule(passingRule);
		const result = validator.validate({ someKey: "value" });

		expect(result.isOk()).toBe(true);
		expect(result.unwrap().someKey).toBe("value");
	});
});
