import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DOCS_URL } from "../../platform/product/product-service.js";
import { FailedConfigFile } from "../config/config-service.js";

export class LegacyConfig {
	static readonly MIGRATION_URL = `${DOCS_URL}/migrating-from-v1`;

	private static readonly KEYS = ["source", "aliases"];
	private static readonly MODE_KEYS = ["output", "build"];
	private static readonly NAME_MAPS = [
		"routes",
		"variants",
		"modes",
		"tree",
		"projects",
	];

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

	static check({ file, value }: FailedConfigFile): readonly Diagnostic[] {
		return LegacyConfig.detects(value)
			? [
					errorDiagnostic(
						"legacy.config",
						{ resource: file },
						`this looks like a config for Rogen 1, which v2 doesn't read. See ${LegacyConfig.MIGRATION_URL} to migrate it.`
					),
				]
			: [];
	}

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
