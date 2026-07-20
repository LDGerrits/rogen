import { FileSystemService } from "../fs/file-system-service.js";
import { err, ok, Result } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";

export class ConfigResolver {
	constructor(private readonly fileSystemService: FileSystemService) {}

	async resolveDependencies(
		rawConfig: Record<string, unknown>
	): Promise<Result<Record<string, unknown>, Error>> {
		const configCopy = { ...rawConfig };

		if (typeof configCopy.template === "string") {
			const templateExists = await this.fileSystemService.exists(
				configCopy.template
			);

			if (!templateExists) {
				return err(
					new Error(
						`Specified template file not found: ${configCopy.template}`
					)
				);
			}

			try {
				const templateContent = await this.fileSystemService.readFile(
					configCopy.template
				);
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
