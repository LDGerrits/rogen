import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FailedConfigFile } from "../config/config-service.js";

/** A config written for Rogen 1, which v2 doesn't read. All knowledge of v1 sits in this module. */
export class LegacyConfig {
	static readonly MIGRATION_URL =
		"https://rogen-playfully.vercel.app/docs/v2/migrating-from-v1";

	private static readonly KEYS = ["source", "aliases", "globIgnorePaths"];
	private static readonly MODE_KEYS = ["output", "build"];

	/** Whether `value`, the JSON of a config file, has the keys of a v1 config. */
	static detects(value: unknown): boolean {
		if (typeof value !== "object" || value === null) return false;
		const fields = Object.entries(value);
		return fields.some(
			([key, field]) =>
				LegacyConfig.KEYS.includes(key) || LegacyConfig.isMode(field)
		);
	}

	/** The hint for a config file that failed to load, or none when it isn't a v1 config. */
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

	/** A v1 mode, such as `luau` or `darklua`, is an object that sets `output` or `build`. */
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
