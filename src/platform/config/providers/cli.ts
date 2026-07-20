import path from "path";
import { ok, Result } from "../../../base/result.js";
import { CliArgs } from "../../cli/args.js";
import { ConfigProvider } from "./provider.js";
import { Mode } from "../schema.js";

export class CliConfigProvider implements ConfigProvider {
	readonly name = "CliProvider";

	constructor(
		private readonly cwd: string,
		private readonly cliArgs: CliArgs
	) {}

	async load(): Promise<Result<Record<string, unknown>, Error>> {
		const overrides: Record<string, unknown> = {};

		if (this.cliArgs.source) overrides.source = this.cliArgs.source;

		if (this.cliArgs.template) {
			overrides.template = path.resolve(this.cwd, this.cliArgs.template);
		}

		if (this.cliArgs.build || this.cliArgs.output || this.cliArgs.env) {
			const targetModes = this.cliArgs.mode || ["luau", "ts", "darklua"];

			for (const mode of targetModes) {
				const modeOverride: Partial<Mode> = {};

				if (this.cliArgs.build) modeOverride.build = this.cliArgs.build;
				if (this.cliArgs.output)
					modeOverride.output = this.cliArgs.output;
				if (this.cliArgs.env) modeOverride.env = this.cliArgs.env;

				overrides[mode] = modeOverride;
			}
		}

		return ok(overrides);
	}
}
