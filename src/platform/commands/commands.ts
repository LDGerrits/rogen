import { Disposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { OptionDescriptor, ParsedArgs } from "../environment/args.js";
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
	readonly options?: readonly OptionDescriptor[];
}

export const GlobalOptions: readonly OptionDescriptor[] = [
	{ name: "help", short: "h", type: "boolean", description: "Print help." },
	{
		name: "version",
		short: "v",
		type: "boolean",
		description: "Print the version.",
	},
	{
		name: "config",
		short: "c",
		type: "string",
		description: "Path to the config file.",
	},
	{
		name: "verbose",
		type: "boolean",
		description: "Print debug output.",
	},
	{
		name: "quiet",
		short: "q",
		type: "boolean",
		description: "Only print errors.",
	},
	{
		name: "trace",
		type: "boolean",
		description: "Print trace output.",
	},
];

export interface CommandRegistry {
	readonly onDidRegisterCommand: Event<string>;

	/** @throws Error if `id` is already registered, or no handler is given. */
	registerCommand(command: Command): Disposable;
	getCommand(id: string): Command | undefined;
	getCommands(): ReadonlyMap<string, Command>;
	/**
	 * Global options plus the given command's own, or every registered
	 * command's when no id is given.
	 */
	getOptions(commandId?: string): readonly OptionDescriptor[];
}

function sameOption(a: OptionDescriptor, b: OptionDescriptor): boolean {
	return (
		a.name === b.name &&
		a.short === b.short &&
		a.type === b.type &&
		!!a.multiple === !!b.multiple
	);
}

function findConflict(
	option: OptionDescriptor,
	known: readonly OptionDescriptor[]
): OptionDescriptor | undefined {
	return known.find(
		(other) =>
			!sameOption(option, other) &&
			(option.name === other.name ||
				(option.short !== undefined && option.short === other.short))
	);
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

		const known = this.getOptions();
		for (const option of command.metadata.options ?? []) {
			const conflict = findConflict(option, known);
			if (conflict) {
				throw new Error(
					`Command "${id}" declares option "--${option.name}" that conflicts with "--${conflict.name}".`
				);
			}
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

	getOptions(commandId?: string): readonly OptionDescriptor[] {
		const options = [...GlobalOptions];
		const commands =
			commandId === undefined
				? [...this.commands.values()]
				: [this.commands.get(commandId)].filter((c) => c !== undefined);
		for (const command of commands) {
			for (const option of command.metadata.options ?? []) {
				if (!options.some((known) => sameOption(option, known))) {
					options.push(option);
				}
			}
		}
		return options;
	}
}

export const Extensions = {
	Commands: "platform.contributions.commands",
};

Registry.add(Extensions.Commands, new CoreCommandRegistry());
