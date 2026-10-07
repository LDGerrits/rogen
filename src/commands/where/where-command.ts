import { formatJsonDocument } from "../../base/json.js";
import { Result, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigSelectionOptions } from "../../domain/config/config.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { LocationReport } from "./location-report.js";

const WhereOptions = [...ConfigSelectionOptions, JsonOption] as const;

registerCommand(
	class WhereCommand extends AbstractCommand<typeof WhereOptions> {
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
								"A file, or a directory for the files in it; a file that doesn't exist yet is placed as if it did. An instance as Studio prints it (ServerScriptService.Inventory.Save:12) gives the files behind it. Every file when none is given. Every config here is read.",
							isOptional: true,
							isVariadic: true,
						},
					],
					options: WhereOptions,
					examples: [
						"rogen where src/Inventory/Server/Save.luau",
						"rogen where ServerScriptService.Inventory.Save:12",
						"rogen where src --json",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof WhereOptions>
		): Promise<Result<void, Error>> {
			const configService = accessor.get(ConfigService);
			const buildService = accessor.get(BuildService);
			const cwd = accessor.get(EnvironmentService).cwd;
			const logService = accessor.get(LogService);

			// The positionals are paths, so every config here is read.
			const selection = await configService.select([], line.options);
			if (selection.isErr()) return selection;
			const located = await buildService.locate(selection.value, {
				args: line.positionals,
				cwd,
			});
			if (located.isErr()) return located;

			const report = new LocationReport(cwd, located.value);
			if (line.options.json) {
				logService.print(formatJsonDocument(report.json()));
				return ok(undefined);
			}
			const lines = report.lines();
			if (lines.length > 0) logService.print(lines.join("\n"));
			return ok(undefined);
		}
	}
);
