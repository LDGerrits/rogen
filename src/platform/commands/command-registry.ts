import { Disposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { ParsedArgs } from "../environment/args.js";
import { Registry } from "../registry/registry.js";

export interface CommandOption {
	readonly name: string;
	readonly short?: string;
	readonly type: "string" | "boolean";
	readonly multiple?: boolean;
	readonly description: string;
}

export interface CommandPositional {
	readonly name: string;
	readonly description: string;
	readonly variadic?: boolean;
}

export type CommandHandler = (args: ParsedArgs) => Promise<Result<void, Error>>;

export interface CommandDescriptor {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly usage?: string;
	readonly positionals?: readonly CommandPositional[];
	readonly options?: readonly CommandOption[];
	readonly precondition?: string;
	readonly handler: CommandHandler;
}

export interface CommandRegistry {
	readonly onDidRegisterCommand: Event<CommandDescriptor>;

	/** @throws Error if `id` is already registered, or no handler is given. */
	registerCommand(descriptor: CommandDescriptor): Disposable;
	getCommand(id: string): CommandDescriptor | undefined;
	getCommands(): readonly CommandDescriptor[];
}

class CoreCommandRegistry implements CommandRegistry {
	private readonly commands = new Map<string, CommandDescriptor>();

	private readonly _onDidRegisterCommand = new Emitter<CommandDescriptor>();
	readonly onDidRegisterCommand: Event<CommandDescriptor> =
		this._onDidRegisterCommand.event;

	registerCommand(descriptor: CommandDescriptor): Disposable {
		if (!descriptor.handler) {
			throw new Error(
				`Command "${descriptor.id}" was registered without a handler.`
			);
		}

		if (this.commands.has(descriptor.id)) {
			throw new Error(
				`Command "${descriptor.id}" is already registered.`
			);
		}

		this.commands.set(descriptor.id, descriptor);
		this._onDidRegisterCommand.fire(descriptor);

		return {
			[Symbol.dispose]: () => {
				this.commands.delete(descriptor.id);
			},
		};
	}

	getCommand(id: string): CommandDescriptor | undefined {
		return this.commands.get(id);
	}

	getCommands(): readonly CommandDescriptor[] {
		return Array.from(this.commands.values());
	}
}

export const Extensions = {
	Commands: "platform.contributions.commands",
};

Registry.add(Extensions.Commands, new CoreCommandRegistry());
