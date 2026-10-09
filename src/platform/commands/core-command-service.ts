import { UsageError } from "../../base/errors.js";
import { Result, err } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import { CommandLine, HELP_COMMAND } from "../environment/args.js";
import { ServicesAccessor } from "../instantiation/instantiation.js";
import { LogService } from "../log/log-service.js";
import { Registry } from "../registry/registry.js";
import { CommandRegistry, CommandService, Extensions } from "./commands.js";

export class CoreCommandService implements CommandService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly accessor: ServicesAccessor,
		private readonly logService: LogService
	) {}

	async executeCommand(
		commandId: string,
		line: CommandLine
	): Promise<Result<void, Error>> {
		this.logService.trace("CommandService#executeCommand", commandId);

		const registry = Registry.as<CommandRegistry>(Extensions.Commands);
		const command = registry.getCommand(commandId);

		if (!command)
			return err(new UsageError(unknownCommand(commandId, registry)));
		if (line.passthrough?.length && !command.metadata.passthrough) {
			return err(
				new UsageError(
					`${commandId} takes nothing after '--'. Run 'rogen ${HELP_COMMAND} ${commandId}' to see what it accepts.`
				)
			);
		}

		return command.handler(this.accessor, line);
	}
}

/** What to say of `commandId`: the version flag, the command it's closest to, or what the command that offers to take the word would do with it. */
function unknownCommand(commandId: string, registry: CommandRegistry): string {
	const prefix = `Unknown command "${commandId}".`;
	// `version` was a command once; the flag does its job now.
	if (commandId === "version")
		return `${prefix} Did you mean 'rogen --version'?`;
	const commands = registry.getCommands();
	const suggestion = closestMatch(commandId, commands.keys());
	if (suggestion) return `${prefix} Did you mean 'rogen ${suggestion}'?`;
	const offering = [...commands.values()].find(
		({ metadata }) => metadata.unknownWordOffer !== undefined
	);
	return offering
		? `${prefix} ${offering.metadata.unknownWordOffer}, run 'rogen ${offering.id} ${commandId}'; run 'rogen ${HELP_COMMAND}' to see the commands.`
		: `${prefix} Run 'rogen ${HELP_COMMAND}' to see the commands.`;
}
