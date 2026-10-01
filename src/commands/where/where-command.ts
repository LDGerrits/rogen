import { formatJsonDocument } from "../../base/json.js";
import { Result, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import {
	ConfigService,
	configRefsFromArgs,
	requireValidEntries,
} from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import {
	ConfigSelectionOptions,
	JsonOption,
	ParsedArgs,
} from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { LocationReport } from "./location-report.js";

registerCommand(
	class WhereCommand extends AbstractCommand {
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
								"A file, or a directory for the files in it; a file that doesn't exist yet is placed as if it did. An instance as Studio prints it (ServerScriptService.Inventory.Save:12) gives the files behind it. Every file when none is given.",
							isOptional: true,
							isVariadic: true,
						},
					],
					options: [...ConfigSelectionOptions, JsonOption],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			args: ParsedArgs
		): Promise<Result<void, Error>> {
			const configService = accessor.get(ConfigService);
			const buildService = accessor.get(BuildService);
			const cwd = accessor.get(EnvironmentService).cwd;
			const logService = accessor.get(LogService);

			// The positionals are paths, so only the flags pick configs.
			const loaded = await configService.initialize(
				configRefsFromArgs(args, [])
			);
			if (loaded.isErr()) return loaded;
			const targets = requireValidEntries(configService.configs);
			if (targets.isErr()) return targets;

			const given = args._.slice(1);
			const report = new LocationReport(cwd);
			for (const { config } of targets.value) {
				const located = await buildService.locate(config, {
					args: given,
					cwd,
				});
				if (located.isErr()) return located;
				report.add(
					config.label,
					located.value.files,
					located.value.instances
				);
			}

			if (args.json) {
				logService.print(
					formatJsonDocument(report.json(given.length === 0))
				);
				return ok(undefined);
			}
			const lines = report.lines(given.length === 0);
			if (lines.length > 0) logService.print(lines.join("\n"));
			return ok(undefined);
		}
	}
);
