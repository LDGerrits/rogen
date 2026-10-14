import { Result, err, ok } from "../../base/result.js";
import {
	ConfigArguments,
	ConfigService,
} from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { projectsOf } from "../../domain/config/resolved-config.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { ServeService } from "../../domain/serve/serve-service.js";
import { ListLog, ServingByConfig, listDocumentShape } from "./list-log.js";

const ListOptions = [JsonOption] as const;

registerCommand(
	class ListCommand extends AbstractCommand<typeof ListOptions> {
		constructor() {
			super({
				id: "list",
				metadata: {
					description:
						"Lists every config here with its source paths, routes, sync path and project files, and which project is served; with --json, each fully resolved.",
					args: ConfigArguments,
					options: ListOptions,
					output: { document: listDocumentShape },
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

			const selection = await configService.select(line.positionals);
			if (selection.isErr()) return selection;
			const { entries, home } = selection.value;
			const report = new ListLog(logService, cwd);
			const broken = ListLog.failure(entries);
			const serveService = accessor.get(ServeService);
			const projectFiles = entries.flatMap((entry) =>
				entry.status === "valid"
					? projectsOf(entry, entry.scope).map(
							({ projectFile }) => projectFile
						)
					: []
			);
			const served = await serveService.servedBy(projectFiles);
			const serving: ServingByConfig = new Map(
				projectFiles.map((file) => [file, served.get(file)])
			);
			for (const note of selection.value.notes) logService.warn(note);

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
