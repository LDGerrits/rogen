import { FileSystemService } from "../fs/file-system-service.js";
import { err, ok, Result } from "../../base/result.js";
import { RojoTree } from "../rojo/tree.js";
import { UserConfig } from "./config.js";

export class ConfigNormalizer {
	constructor(private readonly fileSystemService: FileSystemService) {}

	async normalize(
		mergedConfig: UserConfig
	): Promise<Result<Record<string, unknown>, Error>> {
		// Template must be an object
		if (typeof mergedConfig.template === "string") {
			const templateExists = await this.fileSystemService.exists(
				mergedConfig.template
			);

			if (!templateExists) {
				return err(
					new Error(
						`Specified template file not found: ${mergedConfig.template}`
					)
				);
			}

			try {
				const templateContent = await this.fileSystemService.readFile(
					mergedConfig.template
				);
				mergedConfig.template = JSON.parse(templateContent) as RojoTree;
			} catch (error) {
				return err(
					new Error(
						`Failed to parse template JSON: ${error instanceof Error ? error.message : String(error)}`
					)
				);
			}
		}

		// Source must be an array
		let normalizedSource: string[] = ["src"];
		if (mergedConfig.source) {
			normalizedSource = Array.isArray(mergedConfig.source)
				? mergedConfig.source
				: [mergedConfig.source];
		}

		const normalizedConfig: Record<string, unknown> = {
			...mergedConfig,
			source: normalizedSource,
			template: mergedConfig.template,
			casing: mergedConfig.casing || "camel",
			verbatim: mergedConfig.verbatim || false,
			unwrap: mergedConfig.unwrap || false,
			aliases: mergedConfig.aliases || {},
			globIgnorePaths: mergedConfig.globIgnorePaths || [],
		};

		return ok(normalizedConfig);
	}
}
