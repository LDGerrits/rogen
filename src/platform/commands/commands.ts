import { Disposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { ParsedArgs } from "../environment/args.js";
import {
	ServicesAccessor,
	createServiceIdentifier,
} from "../instantiation/instantiation.js";
import { Registry } from "../registry/registry.js";

export interface CommandEvent {
	readonly commandId: string;
	readonly args: ParsedArgs;
}

export interface CommandService {
	readonly _serviceBrand: undefined;
	readonly onWillExecuteCommand: Event<CommandEvent>;
	readonly onDidExecuteCommand: Event<CommandEvent>;
	executeCommand(
		commandId: string,
		args: ParsedArgs
	): Promise<Result<void, Error>>;
}

export const CommandService =
	createServiceIdentifier<CommandService>("commandService");

export type CommandHandler = (
	accessor: ServicesAccessor,
	args: ParsedArgs
) => Promise<Result<void, Error>>;

export interface Command {
	readonly id: string;
	readonly handler: CommandHandler;
	readonly metadata: CommandMetadata;
}

export interface CommandMetadata {
	readonly description: string;
	readonly args?: readonly {
		readonly name: string;
		readonly description: string;
		readonly isOptional?: boolean;
		readonly isVariadic?: boolean;
	}[];
}

export interface CommandRegistry {
	readonly onDidRegisterCommand: Event<string>;

	/** @throws Error if `id` is already registered, or no handler is given. */
	registerCommand(command: Command): Disposable;
	getCommand(id: string): Command | undefined;
	getCommands(): ReadonlyMap<string, Command>;
}

class CoreCommandRegistry implements CommandRegistry {
	private readonly commands = new Map<string, Command>();

	private readonly _onDidRegisterCommand = new Emitter<string>();
	readonly onDidRegisterCommand: Event<string> =
		this._onDidRegisterCommand.event;

	registerCommand(command: Command): Disposable {
		const { id } = command;

		if (!command.handler) {
			throw new Error(
				`Command "${id}" was registered without a handler.`
			);
		}

		if (this.commands.has(id)) {
			throw new Error(`Command "${id}" is already registered.`);
		}

		this.commands.set(id, command);
		this._onDidRegisterCommand.fire(id);

		return {
			[Symbol.dispose]: () => {
				if (this.commands.get(id) === command) {
					this.commands.delete(id);
				}
			},
		};
	}

	getCommand(id: string): Command | undefined {
		return this.commands.get(id);
	}

	getCommands(): ReadonlyMap<string, Command> {
		return new Map(this.commands);
	}
}

export const Extensions = {
	Commands: "platform.contributions.commands",
};

Registry.add(Extensions.Commands, new CoreCommandRegistry());
