import path from "path";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Result, ok, err } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";
import {
	ConfigSchema,
	ResolvedConfig,
	defaultConfig,
} from "./config-schema.js";
import { mergeDeep } from "../../base/object.js";

export class ConfigParser {
	static async parse(
		rawConfig: Record<string, unknown>,
		configDir: string,
		fs: FileSystemService
	): Promise<Result<ResolvedConfig, Error>> {
		const configCopy = { ...rawConfig };

		if (typeof configCopy.template === "string") {
			const templatePath = path.resolve(configDir, configCopy.template);

			if (!(await fs.exists(templatePath))) {
				return err(
					new Error(
						`Specified template file not found: ${templatePath}`
					)
				);
			}

			try {
				const templateContent = await fs.readFile(templatePath);
				configCopy.template = JSON.parse(templateContent);
			} catch (error) {
				return err(
					new Error(
						`Failed to parse template JSON: ${ErrorUtils.fromUnknown(error).message}`
					)
				);
			}
		}

		const configWithDefaults = mergeDeep<Record<string, unknown>>(
			defaultConfig as Record<string, unknown>,
			configCopy
		);

		const parseResult = ConfigSchema.safeParse(configWithDefaults);

		if (!parseResult.success) {
			const issues = parseResult.error.issues
				.map((i) => `${i.path.join(".")}: ${i.message}`)
				.join(", ");
			return err(new Error(`Configuration validation failed: ${issues}`));
		}

		return ok(parseResult.data);
	}
}
