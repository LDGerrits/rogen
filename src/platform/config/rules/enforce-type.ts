import { IValidationRule } from "./rule.js";
import { err, ok, Result } from "../../../base/result.js";
import { isValidRojoTree, VALID_KEYS } from "../validator.js";

export class EnforceTypeRule implements IValidationRule {
	canHandle(key: string): boolean {
		return key in VALID_KEYS;
	}

	validate(key: string, value: unknown): Result<void, Error> {
		if (
			key === "source" &&
			typeof value !== "string" &&
			!Array.isArray(value)
		) {
			return err(
				new Error(`'source' must be a string or an array of strings.`)
			);
		}

		if (
			(key === "verbatim" || key === "unwrap") &&
			typeof value !== "boolean"
		) {
			return err(new Error(`'${key}' must be a boolean.`));
		}

		if (
			key === "casing" &&
			value !== "PascalCase" &&
			value !== "camelCase"
		) {
			return err(
				new Error(
					`'casing' must be either "PascalCase" or "camelCase".`
				)
			);
		}

		if (key === "globIgnorePaths" && !Array.isArray(value)) {
			return err(
				new Error(`'globIgnorePaths' must be an array of strings.`)
			);
		}

		if (key === "template" && !isValidRojoTree(value)) {
			return err(
				new Error(`'template' must be a valid Rojo Tree object.`)
			);
		}

		return ok(undefined);
	}
}
