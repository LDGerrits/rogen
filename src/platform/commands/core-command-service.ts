import { ErrorUtils, UsageError } from "../../base/errors.js";
import { Result, err } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import { CommandLine, HELP_COMMAND } from "../environment/args.js";
import { ServicesAccessor } from "../instantiation/instantiation.js";
import { LogService } from "../log/log-service.js";
import { CommandRegistry, CommandService } from "./commands.js";

export class CoreCommandService implements CommandService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly accessor: ServicesAccessor,
		private readonly logService: LogService,
		private readonly registry: CommandRegistry
	) {}

	async executeCommand(
		commandId: string,
		line: CommandLine
	): Promise<Result<void, Error>> {
		this.logService.trace("CommandService#executeCommand", commandId);

		const command = this.registry.getCommand(commandId);

		if (!command) return err(unknownCommand(commandId, this.registry));
		if (line.passthrough?.length) {
			return err(
				new UsageError(
					`${commandId} takes nothing after '--'.`,
					`Run 'rogen ${HELP_COMMAND} ${commandId}' to see what it accepts.`
				)
			);
		}

		try {
			return await command.handler(this.accessor, line);
		} catch (error) {
			if (ErrorUtils.isSystemError(error)) return err(error);
			throw error;
		}
	}
}

/** What to say of `commandId`: the version flag, its closest command, or what the command that takes the word would do. */
function unknownCommand(
	commandId: string,
	registry: CommandRegistry
): UsageError {
	const reason = `Unknown command "${commandId}".`;
	if (commandId === "version")
		return new UsageError(reason, "Did you mean 'rogen --version'?");
	const commands = registry.getCommands();
	for (const { metadata } of commands.values()) {
		const former = metadata.formerCommands?.[commandId];
		if (former) return new UsageError(reason, former);
	}
	const suggestion = closestMatch(commandId, commands.keys());
	if (suggestion)
		return new UsageError(reason, `Did you mean 'rogen ${suggestion}'?`);
	const offering = [...commands.values()].find(
		({ metadata }) => metadata.unknownWordOffer !== undefined
	);
	return new UsageError(
		reason,
		offering
			? `${offering.metadata.unknownWordOffer}, run 'rogen ${offering.id} ${commandId}'; run 'rogen ${HELP_COMMAND}' to see the commands.`
			: `Run 'rogen ${HELP_COMMAND}' to see the commands.`
	);
}
