import { Result, err } from "../../base/result.js";
import { ParsedArgs } from "../environment/args.js";
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
		args: ParsedArgs
	): Promise<Result<void, Error>> {
		this.logService.trace("CommandService#executeCommand", commandId);

		const command = Registry.as<CommandRegistry>(
			Extensions.Commands
		).getCommand(commandId);

		if (!command) {
			return err(
				new Error(
					`Unknown command "${commandId}". To build a config, run 'rogen build ${commandId}'; run 'rogen help' to see the commands.`
				)
			);
		}

		return command.handler(this.accessor, args);
	}
}
