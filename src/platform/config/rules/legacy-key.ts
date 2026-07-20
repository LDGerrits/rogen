import { err, Result } from "../../../base/result.js";
import { CoreConfigKeys } from "../config.js";
import { IValidationRule } from "./rule.js";

export class LegacyKeyRule implements IValidationRule {
	private readonly legacyMap: Record<string, CoreConfigKeys> = {
		keepRouteNames: "verbatim",
		keepSuffixes: "verbatim",
	};

	canHandle(key: string): boolean {
		return key in this.legacyMap;
	}

	validate(key: string): Result<void, Error> {
		const modernKey = this.legacyMap[key];
		return err(
			new Error(
				`The key "${key}" has been renamed to "${modernKey}". Please, update your configuration.`
			)
		);
	}
}
