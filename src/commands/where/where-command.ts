import path from "path";
import { ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	ConfigSelectionOptions,
	configRefsFromArgs,
} from "../config-options.js";
import { LocationReport } from "./location-report.js";

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "where",
	metadata: {
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

		const refs = configRefsFromArgs(args, []);
		if (refs.isErr()) return refs;
		const loaded = await configService.initialize(refs.value);
		if (loaded.isErr()) return loaded;

		const valid = configService.requireValidEntries();
		if (valid.isErr()) return valid;

		const paths = args._.slice(1).map((file) => path.resolve(cwd, file));

		const report = new LocationReport(cwd);
		for (const { config } of valid.value) {
			const located = await buildService.locate(
				config,
				paths.length > 0 ? paths : undefined
			);
			if (located.isErr()) return located;
			report.add(config.label, located.value);
		}

		const lines = report.lines(paths.length === 0);
		if (lines.length > 0) logService.print(lines.join("\n"));
		return ok(undefined);
	},
});
