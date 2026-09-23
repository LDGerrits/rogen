import { err, ok } from "../../base/result.js";
import { LogService } from "../../platform/log/log-service.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { GlobalOptions } from "../../platform/environment/args.js";
import { formatCommandHelp, formatHelp } from "./help-formatter.js";

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "help",
	metadata: {
		description: "Prints usage, or details for one command.",
		args: [
			{
				name: "command",
				description: "The command to describe.",
				isOptional: true,
			},
		],
	},
	handler: async (accessor, args) => {
		const registry = Registry.as<CommandRegistry>(Extensions.Commands);
		const logService = accessor.get(LogService);

		// `rogen build --help` and `rogen help build` both name the command.
		const target = args.help ? args._[0] : args._[1];

		if (target === undefined) {
			logService.info(formatHelp(registry.getCommands(), GlobalOptions));
			return ok(undefined);
		}

		const command = registry.getCommand(target.toLowerCase());
		if (!command) {
			return err(
				new Error(
					`Unknown command "${target}". Run 'rogen help' to see available commands.`
				)
			);
		}

		logService.info(formatCommandHelp(command, GlobalOptions));
		return ok(undefined);
	},
});
