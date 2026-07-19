import path from "path";
import { IFileSystem } from "../../fs/file-system.js";
import { ConfigProvider, ConfigContext } from "../schema.js";
import { ok, err, Result } from "../../../base/result.js";
import { Config, Mode } from "../config.js";
import { RojoTree } from "../../rojo/tree.js";

export const createCliProvider = (fs: IFileSystem): ConfigProvider => {
	return async (
		ctx: ConfigContext
	): Promise<Result<Partial<Config>, Error>> => {
		const { cliArgs, cwd } = ctx;
		const overrides: Partial<Config> = {};

		if (cliArgs.source) overrides.source = cliArgs.source;

		// Resolve path to template into RojoTree
		if (cliArgs.template) {
			const templatePath = path.resolve(cwd, cliArgs.template);

			if (!(await fs.exists(templatePath))) {
				return err(
					new Error(
						`Specified template file not found at ${templatePath}`
					)
				);
			}

			try {
				const templateContent = await fs.readFile(templatePath);
				overrides.template = JSON.parse(templateContent) as RojoTree;
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				return err(
					new Error(
						`Failed to parse template JSON at ${templatePath}: ${message}`
					)
				);
			}
		}

		if (cliArgs.build || cliArgs.output || cliArgs.env) {
			const targetModes = cliArgs.mode || ["luau", "ts", "darklua"];

			for (const mode of targetModes) {
				const modeOverride: Partial<Mode> = {};

				if (cliArgs.build) modeOverride.build = cliArgs.build;
				if (cliArgs.output) modeOverride.output = cliArgs.output;
				if (cliArgs.env) modeOverride.env = cliArgs.env;

				overrides[mode] = modeOverride;
			}
		}

		return ok(overrides);
	};
};
