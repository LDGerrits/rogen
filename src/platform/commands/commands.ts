import { DeferredPromise } from "../../base/async.js";
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
	createServiceIdentifier,
} from "../instantiation/instantiation.js";
import { LifecycleService } from "../lifecycle/lifecycle-service.js";
import { LogService } from "../log/log-service.js";
import { Registry } from "../registry/registry.js";
import { OutputDeclaration } from "../output/output-shape.js";

/** A failure already reported in full; only the exit code is left to set. */
export class ReportedError extends Error {
	override readonly name = "ReportedError";

	constructor(cause: Error) {
		super(cause.message, { cause });
	}
}

export class ExitCodeError extends Error {
	override readonly name = "ExitCodeError";

	constructor(
		readonly exitCode: number,
		cause: Error
	) {
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

export const CommandService =
	createServiceIdentifier<CommandService>("commandService");

type CommandHandler = (
	accessor: ServicesAccessor,
	line: CommandLine
) => Promise<Result<void, Error>>;

export interface Command {
	readonly id: string;
	readonly handler: CommandHandler;
	readonly metadata: CommandMetadata;
}

/** What a run of a command can do beyond printing; a command that does none of them is read-only. `longRunning` is not declared here, since a command says it with `longRunning` and `longRunningWith`. */
export type CommandEffect = "writesFiles" | "runsProcesses" | "opensBrowser";

interface CommandMetadata<
	O extends readonly OptionDescriptor[] = readonly OptionDescriptor[],
> {
	/** One line for the list of commands in the root help, without a full stop, as Rojo's are. */
	readonly summary: string;
	readonly description: string;
	readonly args?: readonly {
		readonly name: string;
		readonly description: string;
		readonly isOptional?: boolean;
		readonly isVariadic?: boolean;
		/** For a word that picks what to do, as `install` does for `plugin`: help lists them as subcommands. */
		readonly subcommands?: readonly {
			readonly name: string;
			readonly description: string;
		}[];
	}[];
	readonly options?: O;
	/** What the words after `--` are for; a command without it takes none. */
	readonly passthrough?: {
		readonly name: string;
		readonly description: string;
	};
	readonly examples?: readonly string[];
	/** The JSON this command prints with `--json`; a command with a `--json` option declares it. */
	readonly output?: OutputDeclaration;
	/** What it can do beyond printing, declared by every command: `[]` for one that only reads. */
	readonly effects?: readonly CommandEffect[];
	/** What this command would do with a first word that names no command, offered in its place: "To build a config" offers `rogen build <word>`. */
	readonly unknownWordOffer?: string;
	/** Whether the command runs until it is stopped, so anything to tell the user comes before it starts, not after it ends. */
	readonly longRunning?: boolean;
	/** The boolean option that makes the command run until it is stopped, as `longRunning` says of every run. */
	readonly longRunningWith?: string;
	/** What to say of a first word that was a command and now is a flag or another command, by that word. */
	readonly formerCommands?: Readonly<Record<string, string>>;
	/** What to say of an option this command used to take, by the name as typed (`--yes`, `-y`): what replaces it. */
	readonly formerOptions?: Readonly<Record<string, string>>;
}

export interface CommandRegistry {
	/** @throws Error if `id` is already registered, or an option conflicts with another command's. */
	registerCommand(command: Command): Disposable;
	getCommand(id: string): Command | undefined;
	getCommands(): ReadonlyMap<string, Command>;
	getOptions(commandId?: string): readonly OptionDescriptor[];
	/** What a command says of the options it used to take, by the name as typed. */
	getFormerOptions(commandId: string): Readonly<Record<string, string>>;
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

	getFormerOptions(commandId: string): Readonly<Record<string, string>> {
		return this.commands.get(commandId)?.metadata.formerOptions ?? {};
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

	/** Settles when the process is asked to shut down; subscribed at once, so a request during later awaits still counts. */
	protected untilShutdown(
		accessor: ServicesAccessor,
		store: DisposableStore
	): DeferredPromise<void> {
		const shutdown = new DeferredPromise<void>();
		store.add(
			accessor
				.get(LifecycleService)
				.onWillShutdown(() => shutdown.complete())
		);
		return shutdown;
	}

	protected reported(failure: Error): Result<void, Error> {
		return err(new ReportedError(failure));
	}

	/** Prints the run's one JSON document; a failed run passes `failure`, which then only sets the exit code. */
	protected printJson(
		logService: LogService,
		document: unknown,
		failure?: Error
	): Result<void, Error> {
		logService.print(formatJsonDocument(document));
		return failure ? this.reported(failure) : ok(undefined);
	}
}

/** Contributes one instance of `ctor` to the command registry. */
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
