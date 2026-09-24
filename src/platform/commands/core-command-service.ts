import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { Result, err } from "../../base/result.js";
import { ParsedArgs } from "../environment/args.js";
import { ServicesAccessor } from "../instantiation/instantiation.js";
import { LogService } from "../log/log-service.js";
import { Registry } from "../registry/registry.js";
import {
	CommandEvent,
	CommandRegistry,
	CommandService,
	Extensions,
} from "./commands.js";

export class CoreCommandService
	extends AbstractDisposable
	implements CommandService
{
	declare readonly _serviceBrand: undefined;

	private readonly _onWillExecuteCommand = this._register(
		new Emitter<CommandEvent>()
	);
	readonly onWillExecuteCommand: Event<CommandEvent> =
		this._onWillExecuteCommand.event;

	private readonly _onDidExecuteCommand = this._register(
		new Emitter<CommandEvent>()
	);
	readonly onDidExecuteCommand: Event<CommandEvent> =
		this._onDidExecuteCommand.event;

	constructor(
		private readonly accessor: ServicesAccessor,
		private readonly logService: LogService
	) {
		super();
	}

	executeCommand(
		commandId: string,
		args: ParsedArgs
	): Promise<Result<void, Error>> {
		this.logService.trace("CommandService#executeCommand", commandId);

		const command = Registry.as<CommandRegistry>(
			Extensions.Commands
		).getCommand(commandId);

		if (!command) {
			return Promise.resolve(
				err(
					new Error(
						`Unknown command "${commandId}". To build a config, run 'rogen build ${commandId}'; run 'rogen help' to see the commands.`
					)
				)
			);
		}

		this._onWillExecuteCommand.fire({ commandId, args });
		const result = command.handler(this.accessor, args);
		this._onDidExecuteCommand.fire({ commandId, args });

		return result;
	}
}
