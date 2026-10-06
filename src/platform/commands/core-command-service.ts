import { Result, err } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import { CommandLine } from "../environment/args.js";
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

		if (!command) {
			const suggestion = closestMatch(
				commandId,
				registry.getCommands().keys()
			);
			return err(
				new Error(
					suggestion
						? `Unknown command "${commandId}". Did you mean 'rogen ${suggestion}'?`
						: `Unknown command "${commandId}". To build a config, run 'rogen build ${commandId}'; run 'rogen help' to see the commands.`
				)
			);
		}

		return command.handler(this.accessor, line);
	}
}
