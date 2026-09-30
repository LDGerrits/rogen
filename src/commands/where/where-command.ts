import path from "path";
import { Result, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { registerCommand } from "../../platform/commands/commands.js";
import { ParsedArgs } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import {
	AbstractConfigCommand,
	ConfigSelectionOptions,
} from "../config/config-command.js";
import { LocationReport } from "./location-report.js";

registerCommand(
	class WhereCommand extends AbstractConfigCommand {
		constructor() {
			super({
				id: "where",
				metadata: {
					description:
						"Prints where each file lands in the game, and why.",
					args: [
						{
							name: "path",
							description:
								"A file, or a directory for the files in it; a file that doesn't exist yet is placed as if it did. Every file when none is given.",
							isOptional: true,
							isVariadic: true,
						},
					],
					options: ConfigSelectionOptions,
				},
			});
		}

		/** Its positionals are paths, so only the flags pick configs. */
		protected override configNames(): readonly string[] {
			return [];
		}

		protected async runWithConfigs(
			accessor: ServicesAccessor,
			args: ParsedArgs
		): Promise<Result<void, Error>> {
			const buildService = accessor.get(BuildService);
			const cwd = accessor.get(EnvironmentService).cwd;

			const targets = accessor.get(ConfigService).requireValidEntries();
			if (targets.isErr()) return targets;

			const paths = args._.slice(1).map((file) =>
				path.resolve(cwd, file)
			);
			const report = new LocationReport(cwd);
			for (const { config } of targets.value) {
				const located = await buildService.locate(
					config,
					paths.length > 0 ? paths : undefined
				);
				if (located.isErr()) return located;
				report.add(config.label, located.value);
			}

			const lines = report.lines(paths.length === 0);
			if (lines.length > 0)
				accessor.get(LogService).print(lines.join("\n"));
			return ok(undefined);
		}
	}
);
