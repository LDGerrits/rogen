import path from "path";
import { FileSystemService } from "../../fs/file-system-service.js";
import { ok, err, Result } from "../../../base/result.js";
import { ErrorUtils } from "../../../base/errors.js";
import { ConfigProvider } from "./provider.js";

export class FileConfigProvider implements ConfigProvider {
	readonly name = "FileProvider";

	constructor(
		private readonly cwd: string,
		private readonly fileSystemService: FileSystemService,
		private readonly configPath?: string
	) {}

	async load(): Promise<Result<Record<string, unknown>, Error>> {
		const targetPath =
			this.configPath || path.join(this.cwd, ".rogen.json");
		const exists = await this.fileSystemService.exists(targetPath);

		if (this.configPath && !exists) {
			return err(
				new Error(`Specified config file not found: ${targetPath}`)
			);
		}

		if (!exists) return ok({});

		try {
			const rawContent =
				await this.fileSystemService.readFile(targetPath);
			const parsed = JSON.parse(rawContent) as Record<string, unknown>;

			if (typeof parsed.template === "string") {
				parsed.template = path.resolve(
					path.dirname(targetPath),
					parsed.template
				);
			}

			return ok(parsed);
		} catch (error) {
			return err(
				new Error(
					`Failed to read or parse config file: ${ErrorUtils.fromUnknown(error).message}`
				)
			);
		}
	}
}
