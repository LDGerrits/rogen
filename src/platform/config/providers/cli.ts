import path from "path";
import { ConfigProvider, WorkspaceContext } from "../schema.js";
import { ok, Result } from "../../../base/result.js";
import { UserConfig, Mode } from "../config.js";
import { CliArgs } from "../../cli/args.js";

export const createCliProvider = (cliArgs: CliArgs): ConfigProvider => {
	return async (
		ctx: WorkspaceContext
	): Promise<Result<UserConfig, Error>> => {
		const overrides: UserConfig = {};

		if (cliArgs.source) overrides.source = cliArgs.source;

		if (cliArgs.template) {
			overrides.template = path.resolve(ctx.cwd, cliArgs.template);
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
