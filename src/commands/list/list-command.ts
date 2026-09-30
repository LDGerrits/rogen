import { ReportedError } from "../../base/errors.js";
import { relativeTo } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { plural } from "../../base/strings.js";
import {
	ConfigEntry,
	ConfigService,
	configRefsFromArgs,
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

			const refs = configRefsFromArgs(args, args._.slice(1));
			const loaded = await configService.initialize({
				...refs,
				all:
					refs.all ||
					(refs.names.length === 0 && refs.paths.length === 0),
			});
			if (loaded.isErr()) return loaded;

			if (args.json) return this.listAsJson(accessor);

			logService.intro("rogen list");
			for (const entry of configService.configs)
				this.describe(logService, entry, cwd);

			const broken = configService.getBrokenError();
			if (broken) return err(broken);
			logService.outro(
				`${plural(configService.configs.length, "config")}.`
			);
			return ok(undefined);
		}

		private listAsJson(accessor: ServicesAccessor): Result<void, Error> {
			const configService = accessor.get(ConfigService);
			const report = new ConfigReport(
				accessor.get(EnvironmentService).cwd
			);
			for (const entry of configService.configs) report.add(entry);
			accessor
				.get(LogService)
				.print(JSON.stringify(report.json(), null, 2));

			const broken = configService.getBrokenError();
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

			const config = entry.resolved;
			if (entry.isBroken || !config) {
				for (const error of entry.errors) logService.diagnostic(error);
				return;
			}
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
