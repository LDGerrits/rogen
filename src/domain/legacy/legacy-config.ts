import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DOCS_URL } from "../../platform/product/product-service.js";
import { FailedConfigFile } from "../config/config-service.js";

/** A config written for Rogen 1, which Rogen 2 doesn't read. All knowledge of Rogen 1 sits in this module. */
export class LegacyConfig {
	static readonly MIGRATION_URL = `${DOCS_URL}/migrating-from-v1`;

	private static readonly KEYS = ["source", "aliases", "globIgnorePaths"];
	private static readonly MODE_KEYS = ["output", "build"];
	/** Fields of a Rogen 2 config that are maps from a name to a string, which a route called `build` would look like a mode in. */
	private static readonly NAME_MAPS = ["routes", "variants", "modes"];

	/** Whether `value`, the JSON of a config file, has the keys of a Rogen 1 config. */
	static detects(value: unknown): boolean {
		if (typeof value !== "object" || value === null) return false;
		const fields = Object.entries(value);
		return fields.some(
			([key, field]) =>
				LegacyConfig.KEYS.includes(key) ||
				(!LegacyConfig.NAME_MAPS.includes(key) &&
					LegacyConfig.isMode(field))
		);
	}

	/** The hint for a config file that failed to load, or none when it isn't a Rogen 1 config. */
	static check({ file, value }: FailedConfigFile): readonly Diagnostic[] {
		return LegacyConfig.detects(value)
			? [
					warningDiagnostic(
						"legacy.config",
						{ resource: file },
						`this looks like a config for Rogen 1, which v2 doesn't read. See ${LegacyConfig.MIGRATION_URL} to migrate it.`
					),
				]
			: [];
	}

	/** A Rogen 1 mode, such as `luau` or `darklua`, is an object that sets `output` or `build`. */
	private static isMode(field: unknown): boolean {
		return (
			typeof field === "object" &&
			field !== null &&
			Object.keys(field).some((key) =>
				LegacyConfig.MODE_KEYS.includes(key)
			)
		);
	}
}
