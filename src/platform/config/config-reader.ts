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
		const exists = await this.fs.exists(options.configPath);

		if (!exists) {
			if (options.isOptional) {
				return ok(options.overrides || {});
			}
			return err(
				new Error(
					`Specified config file not found: ${options.configPath}`
				)
			);
		}

		let content: string;

		try {
			content = await this.fs.readFile(options.configPath);
		} catch (error) {
			return err(
				new Error(
					`IO Error while reading config: ${ErrorUtils.fromUnknown(error).message}`
				)
			);
		}

		let fileConfig: Record<string, unknown>;
		try {
			fileConfig = JSON.parse(content);
		} catch (error) {
			return err(
				new Error(
					`Syntax Error in config JSON: ${ErrorUtils.fromUnknown(error).message}`
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
