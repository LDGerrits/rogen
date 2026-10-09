import { Result, err, ok } from "../../base/result.js";
import { plural } from "../../base/strings.js";
import { ConfigSelectionOptions } from "../../domain/config/config.js";
import {
	ConfigEntry,
	ConfigSelection,
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
import { inFolder } from "../build/build-log.js";
import { ConfigReport } from "./config-report.js";

/** The run's result line when some configs are broken; none when every one loads. */
function brokenError(entries: readonly ConfigEntry[]): Error | undefined {
	const broken = entries.filter(({ status }) => status === "broken").length;
	if (broken === 0) return undefined;
	const verb = broken === 1 ? "has" : "have";
	return new Error(
		broken === entries.length
			? `${plural(broken, "config")} ${verb} errors.`
			: `${broken} of ${entries.length} configs ${verb} errors.`
	);
}

const ListOptions = [...ConfigSelectionOptions, JsonOption] as const;

registerCommand(
	class ListCommand extends AbstractCommand<typeof ListOptions> {
		constructor() {
			super({
				id: "list",
				metadata: {
					description:
						"Lists every config here with its root dirs, routes, sync dir, project file and variants, and the separate ones below; with --json, each fully resolved.",
					args: [
						{
							name: "config",
							description:
								"A config's name (lobby for lobby.rogen.json, wherever it is) or path. When none is given, every config here and each one below that extends one here, or those of the nearest folder above that has any.",
							isOptional: true,
							isVariadic: true,
						},
					],
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
			const { entries } = selection.value;
			const broken = brokenError(entries);

			if (line.options.json)
				return this.listAsJson(selection.value, logService);

			logService.intro(
				["rogen list", inFolder(cwd, selection.value.home)]
					.filter((part) => part !== undefined)
					.join(" · ")
			);
			new ConfigReport(entries, selection.value.separate).print(
				logService,
				cwd
			);

			if (broken) return err(broken);
			logService.outro(`${plural(entries.length, "config")}.`);
			return ok(undefined);
		}

		private listAsJson(
			selection: ConfigSelection,
			logService: LogService
		): Result<void, Error> {
			const report = new ConfigReport(
				selection.entries,
				selection.separate
			);
			return this.printJson(
				logService,
				report.json(),
				brokenError(selection.entries)
			);
		}
	}
);
