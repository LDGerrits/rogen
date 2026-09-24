import { ok } from "../../base/result.js";
import { LogService } from "../../platform/log/log-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { requireValidConfigs } from "../../domain/config/valid-configs.js";
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
	},
	handler: async (accessor) => {
		const logService = accessor.get(LogService);
		const configService = accessor.get(ConfigService);

		const configs = requireValidConfigs(configService);
		if (configs.isErr()) return configs;

		for (const config of configs.value) {
			logService.info(`Building. Root dirs: ${config.rootDirs.join(", ")}`);
		}

		// TODO: implement the build pipeline.

		return ok(undefined);
	},
});
