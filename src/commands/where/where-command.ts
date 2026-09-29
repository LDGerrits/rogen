import path from "path";
import { err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { configLabel } from "../../domain/config/config-discovery.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { requireValidConfigs } from "../../domain/config/valid-configs.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { Registry } from "../../platform/registry/registry.js";
import { ConfigSelectionOptions } from "../config-options.js";
import { describeLocation } from "./describe-location.js";
import { ConfigLines, mergeLines } from "./merge-locations.js";

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "where",
	metadata: {
		requiresConfig: true,
		description: "Prints where each file lands in the game, and why.",
		args: [
			{
				name: "path",
				description:
					"A file, or a directory for the files in it; a file that doesn't exist yet is placed as if it did. Every file when none is given.",
				isOptional: true,
				isVariadic: true,
			},
		],
		options: ConfigSelectionOptions,
	},
	handler: async (accessor, args) => {
		const logService = accessor.get(LogService);
		const configService = accessor.get(ConfigService);
		const buildService = accessor.get(BuildService);
		const cwd = accessor.get(EnvironmentService).cwd;

		const configs = requireValidConfigs(configService);
		if (configs.isErr()) return configs;

		const paths = args._.slice(1).map((file) => path.resolve(cwd, file));

		const answers: ConfigLines[] = [];
		for (const config of configs.value) {
			const located = await buildService.locate(
				config,
				paths.length > 0 ? paths : undefined
			);
			if (located.isErr())
				return err(new DiagnosticsError(located.error));
			answers.push({
				label: configLabel(config.file),
				lines: located.value.map((location) => [
					location.source,
					describeLocation(location, cwd),
				]),
			});
		}

		const lines = mergeLines(answers, paths.length === 0);
		if (lines.length > 0) logService.print(lines.join("\n"));
		return ok(undefined);
	},
});
