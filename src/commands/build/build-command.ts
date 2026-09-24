import { err, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { showConfig } from "./show-config.js";
import { ConfigOptions } from "../config-options.js";
import { LogService } from "../../platform/log/log-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { unrequestedConfigNotice } from "../../domain/config/config-discovery.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import {
	entryErrors,
	requireValidConfigs,
} from "../../domain/config/valid-configs.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "build",
	metadata: {
		requiresConfig: true,
		description: "Writes each named config's project file.",
		args: [
			{
				name: "name",
				description: "A config to build.",
				isOptional: true,
				isVariadic: true,
			},
		],
		options: [
			...ConfigOptions,
			{
				name: "show-config",
				type: "boolean",
				description: "Prints the resolved config and exits.",
			},
		],
	},
	handler: async (accessor, args) => {
		const logService = accessor.get(LogService);
		const configService = accessor.get(ConfigService);
		const fileSystemService = accessor.get(FileSystemService);
		const environmentService = accessor.get(EnvironmentService);

		if (args["show-config"]) {
			logService.info(showConfig(configService.configs));
			const errors = configService.configs.flatMap(entryErrors);
			return errors.length > 0
				? err(new DiagnosticsError(errors))
				: ok(undefined);
		}

		const configs = requireValidConfigs(configService);
		if (configs.isErr()) return configs;

		const notice = await unrequestedConfigNotice(
			fileSystemService,
			environmentService.cwd,
			configService.configs.map((entry) => entry.file)
		);
		if (notice) logService.info(notice);

		for (const config of configs.value) {
			logService.info(
				`Building. Root dirs: ${config.rootDirs.join(", ")}`
			);
		}

		// TODO: implement the build pipeline.

		return ok(undefined);
	},
});
