import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { err, ok, Result } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";
import path from "path";

export class ConfigResolver {
	constructor(private readonly fileSystemService: FileSystemService) {}

	async resolveDependencies(
		rawConfig: Record<string, unknown>,
		configDir: string
	): Promise<Result<Record<string, unknown>, Error>> {
		const configCopy = { ...rawConfig };

		if (typeof configCopy.template === "string") {
			const templatePath = path.resolve(configDir, configCopy.template);
			const templateExists =
				await this.fileSystemService.exists(templatePath);

			if (!templateExists) {
				return err(
					new Error(
						`Specified template file not found: ${templatePath}`
					)
				);
			}

			try {
				const templateContent =
					await this.fileSystemService.readFile(templatePath);
				configCopy.template = JSON.parse(templateContent);
			} catch (error) {
				return err(
					new Error(
						`Failed to parse template JSON: ${ErrorUtils.fromUnknown(error).message}`
					)
				);
			}
		}

		return ok(configCopy);
	}
}
