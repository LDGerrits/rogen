import { ReportedError } from "../../base/errors.js";
import { formatJsonDocument } from "../../base/json.js";
import { relativeTo } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { plural } from "../../base/strings.js";
import {
	ConfigEntry,
	ConfigSelection,
	ConfigService,
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
import { ConfigReport } from "./config-report.js";

const listed = (values: readonly string[]): string =>
	values.length > 0 ? values.join(", ") : "(none)";

registerCommand(
	class ListCommand extends AbstractCommand {
		constructor() {
			super({
				id: "list",
				metadata: {
					description:
						"Lists every config here with its root dirs, sync dir, project file and tags.",
					args: [
						{
							name: "name",
							description:
								"A config to list. Every config here when none is given.",
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
			const logService = accessor.get(LogService);
			const configService = accessor.get(ConfigService);
			const cwd = accessor.get(EnvironmentService).cwd;

			const selection = await configService.select(args, {
				unnamed: "all",
			});
			if (selection.isErr()) return selection;
			const { entries, brokenError } = selection.value;

			if (args.json) return this.listAsJson(selection.value, logService);

			logService.intro("rogen list");
			for (const entry of entries) this.describe(logService, entry, cwd);

			if (brokenError) return err(brokenError);
			logService.outro(`${plural(entries.length, "config")}.`);
			return ok(undefined);
		}

		private listAsJson(
			selection: ConfigSelection,
			logService: LogService
		): Result<void, Error> {
			const report = new ConfigReport(selection.entries);
			logService.print(formatJsonDocument(report.json()));

			const broken = selection.brokenError;
			return broken ? err(new ReportedError(broken)) : ok(undefined);
		}

		private describe(
			logService: LogService,
			entry: ConfigEntry,
			cwd: string
		): void {
			const relative = (file: string) => relativeTo(cwd, file);
			logService.step(relative(entry.file));
			if (entry.parents.length > 0) {
				logService.info(
					`extends: ${entry.parents.map(relative).join(" -> ")}`
				);
			}

			if (entry.status === "broken") {
				for (const error of entry.errors) logService.diagnostic(error);
				return;
			}
			const { config } = entry;
			logService.info(
				[
					`root dirs: ${listed(config.rootDirs.map(relative))}`,
					`sync dir: ${listed(config.syncDir ? [relative(config.syncDir)] : [])}`,
					`project file: ${relative(config.outFile)}`,
					`tags: ${listed(config.enabledTags)}`,
				].join("\n")
			);
		}
	}
);
