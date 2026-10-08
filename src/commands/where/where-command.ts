import { Result, err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigSelectionOptions } from "../../domain/config/config.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
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
						"Prints where each file lands in the game, and why, with its warnings.",
					args: [
						{
							name: "path",
							description:
								"A file, or a directory for the files in it; a file that doesn't exist yet is placed as if it did. A :line or :line:col after a file, as a linter prints it, is ignored. An instance as Studio prints it (ServerScriptService.Inventory.Save:12) gives the files behind it. Every file when none is given. Every config here is read.",
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
			const failure =
				report.errors.length > 0
					? new DiagnosticsError(report.errors)
					: undefined;
			if (line.options.json)
				return this.printJson(logService, report.json(), failure);
			const blocks = report.blocks();
			const empty = report.emptyLine();
			if (blocks.length === 0) {
				if (empty) logService.print(empty);
			} else if (line.options.verbose) {
				// A dimmed line under each placement says how to require it.
				for (const block of blocks) {
					logService.print(block.lines.join("\n"));
					for (const expression of block.requires)
						logService.debug(`require: ${expression}`);
				}
			} else {
				logService.print(
					blocks.flatMap(({ lines }) => lines).join("\n")
				);
			}
			return failure ? err(failure) : ok(undefined);
		}
	}
);
