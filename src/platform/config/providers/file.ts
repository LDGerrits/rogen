import path from "path";
import { IFileSystem } from "../../fs/file-system.js";
import { ConfigProvider, WorkspaceContext } from "../validate.js";
import { ok, err, Result } from "../../../base/result.js";
import { UserConfig } from "../config.js";

export const createFileProvider = (fs: IFileSystem): ConfigProvider => {
	return async (
		ctx: WorkspaceContext
	): Promise<Result<UserConfig, Error>> => {
		const configPath = ctx.configPath || path.join(ctx.cwd, ".rogen.json");

		const exists = await fs.exists(configPath);

		if (ctx.configPath && !exists) {
			return err(
				new Error(`Specified config file not found: ${configPath}`)
			);
		}

		if (!exists) {
			return ok({});
		}

		try {
			const rawContent = await fs.readFile(configPath);
			const parsed = JSON.parse(rawContent) as UserConfig;

			if (typeof parsed.template === "string") {
				parsed.template = path.resolve(
					path.dirname(configPath),
					parsed.template
				);
			}

			return ok(parsed);
		} catch (error) {
			return err(
				new Error(
					`Failed to read or parse config file: ${error instanceof Error ? error.message : String(error)}`
				)
			);
		}
	};
};
