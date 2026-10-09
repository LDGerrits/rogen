import { Disposable } from "../../base/disposable.js";
import { ReportedError } from "../../base/errors.js";
import { formatJsonDocument } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import {
	CommandLine,
	GlobalOptions,
	OptionDescriptor,
} from "../environment/args.js";
import {
	ServicesAccessor,
	createServiceIdentifier,
} from "../instantiation/instantiation.js";
import { LogService } from "../log/log-service.js";
import { Registry } from "../registry/registry.js";

export interface CommandService {
	readonly _serviceBrand: undefined;
	executeCommand(
		commandId: string,
		line: CommandLine
	): Promise<Result<void, Error>>;
}

export const CommandService =
	createServiceIdentifier<CommandService>("commandService");

export type CommandHandler = (
	accessor: ServicesAccessor,
	line: CommandLine
) => Promise<Result<void, Error>>;

export interface Command {
	readonly id: string;
	readonly handler: CommandHandler;
	readonly metadata: CommandMetadata;
}

export interface CommandMetadata<
	O extends readonly OptionDescriptor[] = readonly OptionDescriptor[],
> {
	readonly description: string;
	readonly args?: readonly {
		readonly name: string;
		readonly description: string;
		readonly isOptional?: boolean;
		readonly isVariadic?: boolean;
	}[];
	readonly options?: O;
	/** What the words after `--` are for; a command without it takes none. */
	readonly passthrough?: {
		readonly name: string;
		readonly description: string;
	};
	/** Two or three command lines that show the command at work, as help prints them. */
	readonly examples?: readonly string[];
	/** What this command would do with a first word that names no command, offered in its place: "To build a config" offers `rogen build <word>`. */
	readonly unknownWordOffer?: string;
}

export interface CommandRegistry {
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
		const options: OptionDescriptor[] = [...GlobalOptions];
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

/** What a command is, as `rogen help` and the argument parser read it. */
export interface CommandDescriptor<
	O extends readonly OptionDescriptor[] = readonly OptionDescriptor[],
> {
	readonly id: string;
	readonly metadata: CommandMetadata<O>;
}

/** A command as an object: a subclass describes itself to the constructor and does its work in `run`, on a line typed by the options it declares. */
export abstract class AbstractCommand<
	O extends readonly OptionDescriptor[] = readonly [],
> {
	constructor(readonly desc: CommandDescriptor<O>) {}

	abstract run(
		accessor: ServicesAccessor,
		line: CommandLine<O>
	): Promise<Result<void, Error>>;

	/** Prints the run's one JSON document. A run that failed passes `failure`, which then only sets the exit code, since the document says what went wrong. */
	protected printJson(
		logService: LogService,
		document: unknown,
		failure?: Error
	): Result<void, Error> {
		logService.print(formatJsonDocument(document));
		return failure ? err(new ReportedError(failure)) : ok(undefined);
	}
}

/** Contributes one instance of `ctor` to the command registry. The parser checked the line against the options the command declares, which is what lets its handler read it as typed. */
export function registerCommand<O extends readonly OptionDescriptor[]>(
	ctor: new () => AbstractCommand<O>
): Disposable {
	const command = new ctor();
	return Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
		id: command.desc.id,
		metadata: command.desc.metadata,
		handler: (accessor, line) =>
			command.run(accessor, line as CommandLine<O>),
	});
}
