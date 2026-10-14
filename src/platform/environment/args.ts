import { parseArgs as nodeParseArgs } from "util";
import { Result, err, ok } from "../../base/result.js";
import { ErrorUtils, UsageError } from "../../base/errors.js";
import {
	closestMatch,
	joinedClosestFirst,
	joinedWithAnd,
} from "../../base/strings.js";

export interface OptionDescriptor {
	readonly name: string;
	readonly short?: string;
	readonly type: "string" | "boolean";
	readonly multiple?: boolean;
	/** For a flag: whether `--no-<name>` is accepted and means false, as against not given. */
	readonly negatable?: boolean;
	/** For a string option: the only values it takes. */
	readonly values?: readonly string[];
	/** What help writes for a string option's value: `--output <path>`. Defaults to `value`. */
	readonly placeholder?: string;
	/** For a string option: what it is when not given, which help shows. */
	readonly default?: string;
	readonly description: string;
}

type OptionValue<D extends OptionDescriptor> = D extends {
	readonly type: "boolean";
	readonly multiple: true;
}
	? readonly boolean[]
	: D extends { readonly type: "boolean" }
		? boolean
		: D extends { readonly multiple: true }
			? readonly string[]
			: D extends { readonly type: "string" }
				? string
				: boolean | string | readonly string[] | readonly boolean[];

type OptionValues<O extends readonly OptionDescriptor[]> = {
	readonly [D in O[number] as D["name"]]?: OptionValue<D>;
};

export const COLOR_CHOICES = ["auto", "always", "never"] as const;

export const GlobalOptions = [
	{
		name: "color",
		type: "string",
		values: COLOR_CHOICES,
		placeholder: "color",
		default: "auto",
		description: "Whether to colour the output.",
	},
	{ name: "help", short: "h", type: "boolean", description: "Print help." },
	{
		name: "version",
		short: "V",
		type: "boolean",
		description: "Print the version.",
	},
	{
		name: "verbose",
		short: "v",
		type: "boolean",
		multiple: true,
		description: "Print debug output; -vv, trace output.",
	},
	{
		name: "quiet",
		short: "q",
		type: "boolean",
		description: "Only print errors.",
	},
] as const satisfies readonly OptionDescriptor[];

export const HELP_COMMAND = "help";

export const JsonOption = {
	name: "json",
	type: "boolean",
	description: "Print one JSON document instead of text.",
} as const satisfies OptionDescriptor;

/** One command line: the positionals after the command word, and the options it gives, typed by the table `O` the command declares. */
export interface CommandLine<
	O extends readonly OptionDescriptor[] = readonly OptionDescriptor[],
> {
	readonly positionals: readonly string[];
	/** Everything after the first `--`, as typed; only a command that declares `passthrough` gets any. */
	readonly passthrough?: readonly string[];
	readonly options: OptionValues<O> & OptionValues<typeof GlobalOptions>;
}

interface ParsedCli {
	readonly command: string;
	readonly line: CommandLine;
	/** Whether the line names no command and asks for neither help nor the version. */
	readonly bare: boolean;
}

function toOptionTable(options: readonly OptionDescriptor[]) {
	return Object.fromEntries(
		options.map(({ name, short, type, multiple }) => [
			name,
			{ type, ...(short && { short }), ...(multiple && { multiple }) },
		])
	);
}

type Token = ReturnType<typeof nodeParseArgs>["tokens"];
type OptionToken = Extract<NonNullable<Token>[number], { kind: "option" }>;

function tokenize(args: string[], options: readonly OptionDescriptor[]) {
	return nodeParseArgs({
		args,
		options: toOptionTable(options),
		allowPositionals: true,
		allowNegative: true,
		strict: false,
		tokens: true,
	});
}

/** The command a line runs, the one it names, whose options it is checked against, and whether the first positional is the word that runs: `rogen build --help` runs help on `build`, but must still be a valid build line. */
function commandOf(
	values: { version?: unknown; help?: unknown },
	positionals: readonly string[]
): {
	readonly runs: string;
	readonly names: string;
	readonly consumesWord: boolean;
} {
	const named = positionals[0]?.toLowerCase();
	if (named === undefined)
		return { runs: HELP_COMMAND, names: HELP_COMMAND, consumesWord: false };
	const redirected = Boolean(values.version || values.help);
	return {
		runs: redirected ? HELP_COMMAND : named,
		names: named,
		consumesWord: !redirected,
	};
}

/** Whether the token is `--no-<flag>` for a flag called `<flag>`. */
const isNegated = (token: OptionToken): boolean =>
	token.rawName.startsWith("--no-") && token.rawName !== `--${token.name}`;

/** `command` is `undefined` when the line names none. */
function unknownOption(
	{ name, rawName }: OptionToken,
	options: readonly OptionDescriptor[],
	owners: readonly string[],
	command: string | undefined,
	formerOptions: Readonly<Record<string, string>>
): UsageError {
	const former = formerOptions[rawName];
	if (former) return new UsageError(`'${rawName}' is gone.`, former);
	const help = command
		? `Run 'rogen ${HELP_COMMAND} ${command}' to see what ${command} accepts.`
		: `Run 'rogen ${HELP_COMMAND}' to see the commands.`;
	if (owners.length > 0) {
		const many = owners.length > 1;
		return command
			? new UsageError(
					`${command} doesn't take '${rawName}'.`,
					`${joinedWithAnd(owners)} ${many ? "do" : "does"}.`
				)
			: new UsageError(
					`'${rawName}' goes after a command.`,
					`${joinedWithAnd(owners)} ${many ? "take" : "takes"} it.`
				);
	}
	const suggestion = rawName.startsWith("--")
		? closestMatch(
				name,
				options.map((option) => option.name)
			)
		: undefined;
	return new UsageError(
		`Unknown option '${rawName}'.`,
		suggestion ? `Did you mean '--${suggestion}'?` : help
	);
}

/** Node's wording varies by version and talks about positionals, so options are checked here. */
function findOptionProblem(
	tokens: NonNullable<Token>,
	options: readonly OptionDescriptor[],
	ownersOf: (name: string, negated: boolean) => string[],
	command: string | undefined,
	formerOptions: Readonly<Record<string, string>>
): UsageError | undefined {
	for (const token of tokens) {
		if (token.kind !== "option") continue;
		const option = options.find(({ name }) => name === token.name);
		if (!option || (isNegated(token) && !option.negatable)) {
			return unknownOption(
				token,
				options,
				ownersOf(token.name, isNegated(token)),
				command,
				formerOptions
			);
		}
		if (
			option.type === "string" &&
			option.values &&
			token.value !== undefined &&
			!option.values.includes(token.value)
		) {
			return new UsageError(
				`'${token.value}' is not a value of '${token.rawName}'.`,
				`The values are ${joinedClosestFirst(token.value, option.values)}.`
			);
		}
		if (option.type === "boolean" && token.value !== undefined) {
			return new UsageError(
				`Option '${token.rawName}' is a flag and takes no value.`
			);
		}
		const missing =
			token.value === undefined ||
			token.value === "" ||
			(!token.inlineValue && token.value.startsWith("-"));
		if (option.type === "string" && missing) {
			return new UsageError(`Option '${token.rawName}' needs a value.`);
		}
		if (
			option.type === "string" &&
			/^-[^-]/.test(token.rawName) &&
			token.value?.startsWith("=")
		) {
			return new UsageError(
				`Option '${token.rawName}' takes its value after a space, not after '='.`
			);
		}
	}
	return undefined;
}

/** Finds the command with every known option, then checks the line against that command's options; a line for an unknown command is returned unchecked. */
export function parseArgs(
	args: string[],
	optionsFor: (command?: string) => readonly OptionDescriptor[],
	commands: readonly string[],
	/** What a command says of an option it no longer takes, by the name as typed: `--yes`. */
	formerOptionsFor: (
		command: string
	) => Readonly<Record<string, string>> = () => ({})
): Result<ParsedCli, Error> {
	try {
		const allOptions = optionsFor();
		const ownersOf = (name: string, negated: boolean) =>
			commands
				.filter((owner) =>
					optionsFor(owner).some(
						(option) =>
							option.name === name &&
							(!negated || option.negatable)
					)
				)
				.sort();
		const { values, tokens = [] } = tokenize(args, allOptions);
		const terminator = tokens.find(
			(token) => token.kind === "option-terminator"
		);
		const positionals = tokens.flatMap((token) =>
			token.kind === "positional" &&
			(!terminator || token.index < terminator.index)
				? [token.value]
				: []
		);
		const { runs, names, consumesWord } = commandOf(values, positionals);

		if (commands.includes(names)) {
			const problem = findOptionProblem(
				tokens,
				optionsFor(names),
				ownersOf,
				positionals.length > 0 ? names : undefined,
				formerOptionsFor(names)
			);
			if (problem) return err(problem);
		}
		if (values.verbose && values.quiet) {
			return err(
				new UsageError("--verbose can't be combined with --quiet.")
			);
		}
		return ok({
			command: runs,
			bare: positionals.length === 0 && !values.version && !values.help,
			line: {
				positionals: consumesWord ? positionals.slice(1) : positionals,
				...(terminator && {
					passthrough: args.slice(terminator.index + 1),
				}),
				options: values as CommandLine["options"],
			},
		});
	} catch (error) {
		return err(ErrorUtils.fromUnknown(error));
	}
}

export function hasFlag(
	argv: readonly string[],
	option: OptionDescriptor
): boolean {
	const end = argv.indexOf("--");
	return (end === -1 ? argv : argv.slice(0, end)).includes(
		`--${option.name}`
	);
}
