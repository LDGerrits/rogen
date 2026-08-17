import { FileSystemService } from "../fs/file-system-service.js";
import { Result, ok, err } from "../../base/result.js";
import { mergeDeep } from "../../base/object.js";
import { ErrorUtils } from "../../base/errors.js";

export interface ConfigReaderOptions {
	readonly configPath: string;
	readonly isOptional?: boolean;
	readonly overrides?: Record<string, unknown>;
}

export class ConfigReader {
	constructor(private readonly fs: FileSystemService) {}

	async read(
		options: ConfigReaderOptions
	): Promise<Result<Record<string, unknown>, Error>> {
		let fileConfig: Record<string, unknown> = {};

		if (await this.fs.exists(options.configPath)) {
			try {
				const content = await this.fs.readFile(options.configPath);
				fileConfig = JSON.parse(content);
			} catch (error) {
				return err(
					new Error(
						`Failed to parse config JSON: ${ErrorUtils.fromUnknown(error).message}`
					)
				);
			}
		} else if (!options.isOptional) {
			return err(
				new Error(
					`Specified config file not found: ${options.configPath}`
				)
			);
		}

		const rawConfig = mergeDeep<Record<string, unknown>>(
			fileConfig,
			options.overrides || {}
		);

		return ok(rawConfig);
	}
}
