import { IValidationRule } from "./rule.js";
import { err, Result } from "../../../base/result.js";
import { getClosestMatch } from "../../../base/string.js";
import { VALID_KEYS } from "../validator.js";

export class UnknownKeyRule implements IValidationRule {
	canHandle(): boolean {
		return true;
	}

	validate(key: string): Result<void, Error> {
		const closestMatch = getClosestMatch(key, VALID_KEYS, 2);

		if (closestMatch) {
			return err(
				new Error(
					`Unknown key "${key}". Did you mean "${closestMatch}"?`
				)
			);
		}

		return err(new Error(`Unknown configuration key "${key}".`));
	}
}
