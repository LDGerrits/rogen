import path from "path";
import { IFileSystem } from "../../fs/file-system.js";
import { ConfigProvider, ConfigContext } from "../schema.js";
import { ok, err, Result } from "../../../base/result.js";
import { Config } from "../config.js";

export const createConfigProvider = (fs: IFileSystem): ConfigProvider => {
	return async (
		ctx: ConfigContext
	): Promise<Result<Partial<Config>, Error>> => {
		const configPath = ctx.cliArgs.config
			? path.resolve(ctx.cwd, ctx.cliArgs.config)
			: path.join(ctx.cwd, ".rogen.json");

		const exists = await fs.exists(configPath);

		if (ctx.cliArgs.config && !exists) {
			return err(
				new Error(`Specified config file not found: ${configPath}`)
			);
		}

		if (!exists) {
			return ok({});
		}

		try {
			const rawContent = await fs.readFile(configPath);
			const parsed = JSON.parse(rawContent) as Record<string, unknown>;

			// Resolve template path
			if (typeof parsed.template === "string") {
				const templatePath = path.resolve(ctx.cwd, parsed.template);
				if (!(await fs.exists(templatePath))) {
					return err(
						new Error(
							`Specified template file not found: ${templatePath}`
						)
					);
				}
				const templateContent = await fs.readFile(templatePath);
				parsed.template = JSON.parse(templateContent);
			}

			return ok(parsed as Partial<Config>);
		} catch (error) {
			return err(
				new Error(
					`Failed to read or parse config file: ${error instanceof Error ? error.message : String(error)}`
				)
			);
		}
	};
};
