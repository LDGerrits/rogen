import path from "path";
import { parse } from "../../base/jsonc.js";
import { tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	FileReader,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { DOCS_URL } from "../../platform/product/product-service.js";
import { FailedConfigFile } from "../config/config-service.js";

export class LegacyConfig {
	static readonly MIGRATION_URL = `${DOCS_URL}/migrating-from-v1`;

	private static readonly FILE_NAME = /^(.*\.)?rogen\.jsonc?$/;
	private static readonly KEYS = ["source", "aliases"];
	private static readonly MODE_KEYS = ["output", "build"];
	private static readonly NAME_MAPS = ["routes", "tree", "projects"];
	private static readonly BETA_NAME_MAPS = ["variants", "modes"];

	static detects(value: unknown): boolean {
		if (typeof value !== "object" || value === null) return false;
		const fields = Object.entries(value);
		return fields.some(
			([key, field]) =>
				LegacyConfig.KEYS.includes(key) ||
				(!LegacyConfig.isNameMap(key) && LegacyConfig.isMode(field))
		);
	}

	/** The v1 configs of a folder: `.rogen.json`, `rogen.json` and any `*.rogen.json`, by what they hold. */
	static async find(
		folder: string,
		files: FileReader
	): Promise<readonly Diagnostic[]> {
		const listing = await tryWithAsync(() => files.readDirectory(folder));
		if (listing.isErr()) return [];
		const found: Diagnostic[] = [];
		for (const [name, type] of listing.value) {
			if (!isFileType(type) || !LegacyConfig.FILE_NAME.test(name))
				continue;
			const file = path.join(folder, name);
			const text = await tryWithAsync(() => files.readFile(file));
			if (text.isErr()) continue;
			const value = parse(text.value);
			if (value.isOk())
				found.push(...LegacyConfig.check({ file, value: value.value }));
		}
		return found;
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

	private static isNameMap(key: string): boolean {
		return (
			LegacyConfig.NAME_MAPS.includes(key) ||
			LegacyConfig.BETA_NAME_MAPS.includes(key)
		);
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
