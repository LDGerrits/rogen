import { FileSystemService } from "../../fs/file-system-service.js";
import { ok, err, Result } from "../../../base/result.js";
import { ErrorUtils } from "../../../base/errors.js";
import { ConfigProvider } from "../provider.js";

export class FileConfigProvider implements ConfigProvider {
	readonly name = "FileProvider";

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly configPath: string,
		private readonly isOptional: boolean = false
	) {}

	async load(): Promise<Result<Record<string, unknown>, Error>> {
		const exists = await this.fileSystemService.exists(this.configPath);

		if (!exists) {
			if (this.isOptional) return ok({});
			return err(
				new Error(`Specified config file not found: ${this.configPath}`)
			);
		}

		try {
			const rawContent = await this.fileSystemService.readFile(
				this.configPath
			);
			return ok(JSON.parse(rawContent) as Record<string, unknown>);
		} catch (error) {
			return err(
				new Error(
					`Failed to read or parse config file: ${ErrorUtils.fromUnknown(error).message}`
				)
			);
		}
	}
}
