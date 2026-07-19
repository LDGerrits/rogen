import { Result, ok, err } from "../../base/result.js";
import { getClosestMatch } from "../../base/string.js";
import { CliArgs } from "../cli/args.js";
import { Config } from "./config.js";

export interface ConfigContext {
	cwd: string;
	cliArgs: CliArgs;
}

export type ConfigProvider = (
	ctx: ConfigContext
) => Promise<Result<Partial<Config>, Error>>;

// TODO can we create this from the type, or, like, in a way that it will give a typeError if it does not have exactly the same keys as Config?
const VALID_KEYS = [
	"source",
	"verbatim",
	"casing",
	"unwrap",
	"aliases",
	"globIgnorePaths",
	"luau",
	"ts",
	"darklua",
	"template",
];

/**
 * Validates the completely merged state of the configuration, enforcing types
 * and checking for spelling mistakes in keys.
 */
export function validateFinalConfig(
	raw: Record<string, unknown>
): Result<Config, Error> {
	for (const key of Object.keys(raw)) {
		if (!VALID_KEYS.includes(key)) {
			// Catch legacy updates gracefully
			if (key === "keepRouteNames" || key === "keepSuffixes") {
				return err(
					new Error(
						`The key "${key}" has been renamed to "verbatim". Please, update your configuration.`
					)
				);
			}

			// Support for custom modes
			if (
				typeof raw[key] === "object" &&
				raw[key] !== null &&
				!Array.isArray(raw[key])
			) {
				const modeData = raw[key] as Record<string, unknown>;
				if (
					typeof modeData.output !== "string" ||
					typeof modeData.build !== "string"
				) {
					return err(
						new Error(
							`Custom mode "${key}" is missing a valid "output" or "build" string.`
						)
					);
				}
				continue;
			}

			// Typo detection
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

		// Type enforcement
		if (
			key === "source" &&
			typeof raw[key] !== "string" &&
			!Array.isArray(raw[key])
		) {
			return err(
				new Error(`'source' must be a string or an array of strings.`)
			);
		}
		if (key === "verbatim" || key === "unwrap") {
			if (typeof raw[key] !== "boolean")
				return err(new Error(`'${key}' must be a boolean.`));
		}
		if (
			key === "casing" &&
			raw[key] !== "PascalCase" &&
			raw[key] !== "camelCase"
		) {
			return err(
				new Error(
					`'casing' must be either "PascalCase" or "camelCase".`
				)
			);
		}
		if (key === "globIgnorePaths" && !Array.isArray(raw[key])) {
			return err(
				new Error(`'globIgnorePaths' must be an array of strings.`)
			);
		}
		if (key === "template" && typeof raw[key] !== "object") {
			return err(
				new Error(`'template' must be a valid Rojo Tree object.`)
			);
		}
	}

	return ok(raw as Config);
}
