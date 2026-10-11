import { Result, err, ok } from "../../base/result.js";
import {
	ConfigArguments,
	ConfigSelectionOptions,
	ConfigService,
} from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { ServeService } from "../../domain/serve/serve-service.js";
import { ListLog, ServingByConfig } from "./list-log.js";

const ListOptions = [...ConfigSelectionOptions, JsonOption] as const;

registerCommand(
	class ListCommand extends AbstractCommand<typeof ListOptions> {
		constructor() {
			super({
				id: "list",
				metadata: {
					description:
						"Lists every config here with its root dirs, routes, sync dir, project file and variants; with --json, each fully resolved.",
					args: ConfigArguments,
					options: ListOptions,
					examples: ["rogen list", "rogen list --json"],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof ListOptions>
		): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);
			const configService = accessor.get(ConfigService);
			const cwd = accessor.get(EnvironmentService).cwd;

			const selection = await configService.select(
				line.positionals,
				line.options
			);
			if (selection.isErr()) return selection;
			const { entries, home } = selection.value;
			const report = new ListLog(logService, cwd);
			const broken = ListLog.failure(entries);
			const serveService = accessor.get(ServeService);
			const serving: ServingByConfig = new Map(
				await Promise.all(
					entries.map(
						async (entry) =>
							[
								entry.file,
								entry.status === "valid"
									? await serveService.servedBy(
											entry.config.outFile
										)
									: undefined,
							] as const
					)
				)
			);

			if (line.options.json)
				return this.printJson(
					logService,
					report.json(entries, serving),
					broken
				);

			report.print(entries, home, serving);
			return broken ? err(broken) : ok(undefined);
		}
	}
);
