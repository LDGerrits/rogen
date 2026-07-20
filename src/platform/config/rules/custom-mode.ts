import { IValidationRule } from "./rule.js";
import { err, ok, Result } from "../../../base/result.js";
import { VALID_KEYS } from "../validator.js";

export class CustomModeRule implements IValidationRule {
	canHandle(key: string, value: unknown): boolean {
		const isObject =
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value);
		return !(key in VALID_KEYS) && isObject;
	}

	validate(key: string, value: unknown): Result<void, Error> {
		const modeData = value as Record<string, unknown>;

		const isValidMode =
			typeof modeData.output === "string" &&
			typeof modeData.build === "string";

		if (isValidMode) {
			return ok(undefined);
		}

		return err(
			new Error(
				`Custom mode "${key}" is missing a valid "output" or "build" string.`
			)
		);
	}
}
