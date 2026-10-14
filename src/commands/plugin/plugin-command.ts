import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { CommandLine } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { reportRojo, reportRojoBesideFailure } from "../build/report-rojo.js";

const PluginOptions = [] as const;

const SUBCOMMANDS = [
	{ name: "install", description: "Installs Rojo's Studio plugin." },
	{ name: "uninstall", description: "Removes Rojo's Studio plugin." },
];

registerCommand(
	class PluginCommand extends AbstractCommand<typeof PluginOptions> {
		constructor() {
			super({
				id: "plugin",
				metadata: {
					description:
						"Installs or removes Rojo's Studio plugin, with the Rojo your toolchain file pins, so the plugin matches the server 'rogen serve' starts.",
					args: [
						{
							name: "action",
							description:
								"install, or uninstall to remove the plugin.",
							subcommands: SUBCOMMANDS,
						},
					],
					options: PluginOptions,
					effects: ["writesFiles", "runsProcesses"],
					examples: [
						"rogen plugin install",
						"rogen plugin uninstall",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof PluginOptions>
		): Promise<Result<void, Error>> {
			const [action, ...rest] = line.positionals;
			if (
				!SUBCOMMANDS.some(({ name }) => name === action) ||
				rest.length > 0
			)
				return err(
					new UsageError("'rogen plugin' takes install or uninstall.")
				);
			const logService = accessor.get(LogService);
			const cwd = accessor.get(EnvironmentService).cwd;

			const ran = await accessor
				.get(RojoCommandService)
				.runBare({ args: ["plugin", action], cwd });
			if (ran.isErr()) return ran;
			const { messages, failure } = ran.value;
			(failure ? reportRojoBesideFailure : reportRojo)(
				logService,
				messages,
				cwd
			);
			if (failure) return err(failure);
			logService.success(
				action === "install"
					? "Rojo's plugin installed"
					: "Rojo's plugin removed"
			);
			return ok(undefined);
		}
	}
);
