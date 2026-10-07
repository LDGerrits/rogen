import { UsageError } from "../../base/errors.js";
import { Result, err } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import { CommandLine, GlobalOptions } from "../environment/args.js";
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

		if (!command) return err(new UsageError(unknownCommand(commandId)));

		return command.handler(this.accessor, line);
	}
}

/** What to say of `commandId`: the flag of that name, the command it's closest to, or that a config is built by `build`. */
function unknownCommand(commandId: string): string {
	const prefix = `Unknown command "${commandId}".`;
	const flag = GlobalOptions.find(({ name }) => name === commandId);
	if (flag) return `${prefix} Did you mean 'rogen --${flag.name}'?`;
	const registry = Registry.as<CommandRegistry>(Extensions.Commands);
	const suggestion = closestMatch(commandId, registry.getCommands().keys());
	return suggestion
		? `${prefix} Did you mean 'rogen ${suggestion}'?`
		: `${prefix} To build a config, run 'rogen build ${commandId}'; run 'rogen help' to see the commands.`;
}
