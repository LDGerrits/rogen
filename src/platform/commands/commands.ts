import {
	Disposable,
	DisposableStore,
	toDisposable,
} from "../../base/disposable.js";
import { formatJsonDocument } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import {
	CommandLine,
	GlobalOptions,
	OptionDescriptor,
} from "../environment/args.js";
import {
	ServicesAccessor,
	createDecorator,
} from "../instantiation/instantiation.js";
import { LifecycleService } from "../lifecycle/lifecycle-service.js";
import { LogService } from "../log/log-service.js";
import { Registry } from "../registry/registry.js";
import { OutputDeclaration } from "../output/output-shape.js";

export class ReportedError extends Error {
	override readonly name = "ReportedError";

	constructor(cause: Error) {
		super(cause.message, { cause });
	}
}

export interface CommandService {
	readonly _serviceBrand: undefined;
	executeCommand(
		commandId: string,
		line: CommandLine
	): Promise<Result<void, Error>>;
}

export const CommandService = createDecorator<CommandService>("commandService");

type CommandHandler = (
	accessor: ServicesAccessor,
	line: CommandLine
) => Promise<Result<void, Error>>;

export interface Command {
	readonly id: string;
	readonly handler: CommandHandler;
	readonly metadata: CommandMetadata;
}

type CommandEffect = "writesFiles" | "runsProcesses" | "opensBrowser";

interface CommandMetadata<
	O extends readonly OptionDescriptor[] = readonly OptionDescriptor[],
> {
	readonly summary: string;
	readonly description: string;
	readonly args?: readonly {
		readonly name: string;
		readonly description: string;
		readonly isOptional?: boolean;
		readonly isVariadic?: boolean;
		readonly subcommands?: readonly {
			readonly name: string;
			readonly description: string;
		}[];
	}[];
	readonly options?: O;
	readonly examples?: readonly string[];
	readonly exitCodes?: Readonly<Record<string, string>>;
	readonly output?: OutputDeclaration;
	readonly effects?: readonly CommandEffect[];
	readonly unknownWordOffer?: string;
	readonly longRunning?: boolean;
	readonly longRunningWith?: string;
	readonly formerCommands?: Readonly<Record<string, string>>;
}

export interface CommandRegistry {
	registerCommand(command: Command): Disposable;
	getCommand(id: string): Command | undefined;
	getCommands(): ReadonlyMap<string, Command>;
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

		return toDisposable(() => {
			if (this.commands.get(id) === command) {
				this.commands.delete(id);
			}
		});
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

interface CommandDescriptor<
	O extends readonly OptionDescriptor[] = readonly OptionDescriptor[],
> {
	readonly id: string;
	readonly metadata: CommandMetadata<O>;
}

export abstract class AbstractCommand<
	O extends readonly OptionDescriptor[] = readonly [],
> {
	constructor(readonly desc: CommandDescriptor<O>) {}

	abstract run(
		accessor: ServicesAccessor,
		line: CommandLine<O>
	): Promise<Result<void, Error>>;

	protected untilShutdown(
		lifecycleService: LifecycleService,
		store: DisposableStore
	): AbortSignal {
		const shutdown = new AbortController();
		store.add(lifecycleService.onWillShutdown(() => shutdown.abort()));
		return shutdown.signal;
	}

	protected reported(failure: Error): Result<void, Error> {
		return err(new ReportedError(failure));
	}

	protected printJson(
		logService: LogService,
		document: unknown,
		failure?: Error
	): Result<void, Error> {
		logService.print(formatJsonDocument(document));
		return failure ? this.reported(failure) : ok(undefined);
	}
}

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
