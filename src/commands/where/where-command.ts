import path from "path";
import { err, ok } from "../../base/result.js";
import { locateFiles, rootsToIndex } from "../../domain/build/build.js";
import { configLabel } from "../../domain/config/config-discovery.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { requireValidConfigs } from "../../domain/config/valid-configs.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { Registry } from "../../platform/registry/registry.js";
import { ConfigOptions, configRefsFromArgs } from "../config-options.js";
import { describeLocation } from "./describe-location.js";

const WHERE_OPTIONS = ["all", "config", "tag", "no-tag"];

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "where",
	metadata: {
		description: "Prints where each file lands in the game, and why.",
		args: [
			{
				name: "path",
				description:
					"A file or directory; a file that doesn't exist yet is placed as if it did. Every file when none is given.",
				isOptional: true,
				isVariadic: true,
			},
		],
		options: ConfigOptions.filter(({ name }) =>
			WHERE_OPTIONS.includes(name)
		),
	},
	handler: async (accessor, args) => {
		const logService = accessor.get(LogService);
		const configService = accessor.get(ConfigService);
		const indexService = accessor.get(IndexService);
		const cwd = accessor.get(EnvironmentService).cwd;

		const refs = configRefsFromArgs(args, []);
		if (refs.isErr()) return refs;
		const initialized = await configService.initialize(refs.value);
		if (initialized.isErr()) return initialized;
		const configs = requireValidConfigs(configService);
		if (configs.isErr()) return configs;

		const paths = args._.slice(1).map((file) => path.resolve(cwd, file));
		await indexService.initialize(rootsToIndex(configs.value));

		const sections: string[][] = [];
		for (const config of configs.value) {
			const located = locateFiles(
				indexService,
				config,
				paths.length > 0 ? paths : undefined
			);
			if (located.isErr())
				return err(new DiagnosticsError(located.error));
			const lines = located.value.map((location) =>
				describeLocation(location, cwd)
			);
			sections.push(
				configs.value.length === 1
					? lines
					: [
							configLabel(config.file),
							...lines.map((line) => `  ${line}`),
						]
			);
		}

		const output = sections.flat();
		if (output.length > 0) logService.print(output.join("\n"));
		return ok(undefined);
	},
});
