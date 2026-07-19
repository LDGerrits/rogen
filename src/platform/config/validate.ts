import { Result, ok, err } from "../../base/result.js";
import { getClosestMatch } from "../../base/string.js";
import { RojoTree } from "../rojo/tree.js";
import { CoreConfigKeys, ResolvedConfig, UserConfig } from "./config.js";

export interface WorkspaceContext {
	cwd: string;
	configPath?: string;
}

export type ConfigProvider = (
	ctx: WorkspaceContext
) => Promise<Result<UserConfig, Error>>;

const VALID_KEYS_MAP: Record<CoreConfigKeys, true> = {
	source: true,
	verbatim: true,
	casing: true,
	unwrap: true,
	aliases: true,
	globIgnorePaths: true,
	luau: true,
	ts: true,
	darklua: true,
	template: true,
};

const VALID_KEYS = Object.keys(VALID_KEYS_MAP);

const LEGACY_KEYS: Record<string, CoreConfigKeys> = {
	keepRouteNames: "verbatim",
	keepSuffixes: "verbatim",
};

export function isValidRojoTree(value: unknown): value is RojoTree {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const record = value as Record<string, unknown>;

	return (
		typeof record.name === "string" &&
		typeof record.tree === "object" &&
		record.tree !== null &&
		!Array.isArray(record.tree)
	);
}

/**
 * Validates the configuration, enforcing types and checking for spelling mistakes in keys.
 */
export function validateConfig(
	raw: Record<string, unknown>
): Result<ResolvedConfig, Error> {
	for (const key of Object.keys(raw)) {
		if (!VALID_KEYS.includes(key)) {
			// Catch legacy updates
			if (key in LEGACY_KEYS) {
				const modernKey = LEGACY_KEYS[key];
				return err(
					new Error(
						`The key "${key}" has been renamed to "${modernKey}". Please, update your configuration.`
					)
				);
			}

			// Validate custom modes versus typos
			const isObject =
				typeof raw[key] === "object" &&
				raw[key] !== null &&
				!Array.isArray(raw[key]);
			const modeData = isObject
				? (raw[key] as Record<string, unknown>)
				: null;
			const isValidMode =
				modeData &&
				typeof modeData.output === "string" &&
				typeof modeData.build === "string";

			if (isValidMode) {
				continue;
			}

			// Check for typos
			const closestMatch = getClosestMatch(key, VALID_KEYS, 2);
			if (closestMatch) {
				return err(
					new Error(
						`Unknown key "${key}". Did you mean "${closestMatch}"?`
					)
				);
			}

			// It has mode characteristics but is missing keys
			const intendedAsMode =
				modeData &&
				("output" in modeData ||
					"build" in modeData ||
					"env" in modeData ||
					"globIgnorePaths" in modeData);

			if (intendedAsMode) {
				return err(
					new Error(
						`Custom mode "${key}" is missing a valid "output" or "build" string.`
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
		if (key === "casing" && raw[key] !== "pascal" && raw[key] !== "camel") {
			return err(
				new Error(`'casing' must be either "pascal" or "camel".`)
			);
		}
		if (key === "globIgnorePaths" && !Array.isArray(raw[key])) {
			return err(
				new Error(`'globIgnorePaths' must be an array of strings.`)
			);
		}
		if (key === "template" && typeof raw[key] !== "object") {
			if (!isValidRojoTree(raw[key])) {
				return err(
					new Error(
						`'template' must be a valid Rojo Project containing a 'name' string and a 'tree' object.`
					)
				);
			}
		}
	}

	return ok(raw as ResolvedConfig);
}
