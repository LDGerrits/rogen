import path from "path";
import { err, ok } from "../../base/result.js";
import { findConfigFiles } from "../../domain/config/config-discovery.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { entryErrors } from "../../domain/config/valid-configs.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
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
		const fileSystemService = accessor.get(FileSystemService);
		const cwd = accessor.get(EnvironmentService).cwd;

		const files = await findConfigFiles(fileSystemService, cwd);
		if (files.isErr()) return files;

		const initialized = await configService.initialize({
			names: [],
			paths: files.value,
		});
		if (initialized.isErr()) return initialized;

		const relative = (file: string) => path.relative(cwd, file) || ".";
		const list = (values: readonly string[]) =>
			values.length > 0 ? values.join(", ") : "(none)";

		logService.intro("rogen list");

		let broken = 0;
		for (const entry of configService.configs) {
			logService.step(relative(entry.file));
			if (entry.chain.length > 1) {
				logService.info(
					`extends: ${entry.chain.slice(1).map(relative).join(" -> ")}`
				);
			}

			const errors = entryErrors(entry);
			if (errors.length > 0 || !entry.resolved) {
				broken++;
				for (const error of errors) logService.diagnostic(error);
			} else {
				const config = entry.resolved;
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

		if (broken > 0) {
			return err(
				new Error(
					`${broken} of ${files.value.length} configs have errors.`
				)
			);
		}

		logService.outro(
			`${files.value.length} ${files.value.length === 1 ? "config" : "configs"}.`
		);
		return ok(undefined);
	},
});
