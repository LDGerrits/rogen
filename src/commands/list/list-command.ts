import { relativeTo } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { plural } from "../../base/string.js";
import {
	ConfigEntry,
	ConfigService,
} from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";

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
				},
			});
		}

		async run(accessor: ServicesAccessor): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);
			const configService = accessor.get(ConfigService);
			const cwd = accessor.get(EnvironmentService).cwd;

			const loaded = await configService.initialize({
				names: [],
				paths: [],
				all: true,
			});
			if (loaded.isErr()) return loaded;

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

		private describe(
			logService: LogService,
			entry: ConfigEntry,
			cwd: string
		): void {
			const relative = (file: string) => relativeTo(cwd, file);
			logService.step(relative(entry.file));
			if (entry.chain.length > 1) {
				logService.info(
					`extends: ${entry.chain.slice(1).map(relative).join(" -> ")}`
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
