import { relativeTo } from "../../base/path.js";
import { err, ok } from "../../base/result.js";
import {
	ConfigService,
	brokenConfigsError,
} from "../../domain/config/config-service.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { Registry } from "../../platform/registry/registry.js";

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "list",
	metadata: {
		description:
			"Lists every config here with its root dirs, sync dir, project file and tags.",
	},
	handler: async (accessor) => {
		const logService = accessor.get(LogService);
		const configService = accessor.get(ConfigService);
		const cwd = accessor.get(EnvironmentService).cwd;

		const initialized = await configService.initialize({
			names: [],
			paths: [],
			all: true,
		});
		if (initialized.isErr()) return initialized;

		const relative = (file: string) => relativeTo(cwd, file);
		const list = (values: readonly string[]) =>
			values.length > 0 ? values.join(", ") : "(none)";

		logService.intro("rogen list");

		for (const entry of configService.configs) {
			logService.step(relative(entry.file));
			if (entry.chain.length > 1) {
				logService.info(
					`extends: ${entry.chain.slice(1).map(relative).join(" -> ")}`
				);
			}

			const config = entry.resolved;
			if (entry.errors.length > 0 || !config) {
				for (const error of entry.errors) logService.diagnostic(error);
			} else {
				logService.info(
					[
						`root dirs: ${list(config.rootDirs.map(relative))}`,
						`sync dir: ${list(config.syncDir ? [relative(config.syncDir)] : [])}`,
						`project file: ${relative(config.outFile)}`,
						`tags: ${list(Object.keys(config.tags).filter((tag) => config.tags[tag]))}`,
					].join("\n")
				);
			}
		}

		const broken = brokenConfigsError(configService.configs);
		if (broken) return err(broken);

		const count = configService.configs.length;
		logService.outro(`${count} ${count === 1 ? "config" : "configs"}.`);
		return ok(undefined);
	},
});
