import { parseArgs as nodeParseArgs } from "util";
import { Result, err, ok } from "../../base/result.js";
import { UsageError } from "../../base/errors.js";
import {
	closestMatch,
	joinedClosestFirst,
	joinedWithAnd,
} from "../../base/strings.js";

export interface OptionDescriptor {
	readonly name: string;
	readonly short?: string;
	readonly aliases?: readonly string[];
	readonly type: "string" | "boolean";
	readonly multiple?: boolean;
	readonly negation?: "also" | "only";
	readonly values?: readonly string[];
	readonly placeholder?: string;
	readonly default?: string;
	readonly description: string;
}

type OptionValue<D extends OptionDescriptor> = D extends {
	readonly type: "boolean";
	readonly multiple: true;
}
	? readonly boolean[]
	: D extends { readonly type: "boolean"; readonly negation: "also" }
		? boolean
		: D extends { readonly type: "boolean"; readonly negation: "only" }
			? false
			: D extends { readonly type: "boolean" }
				? true
				: D extends { readonly multiple: true }
					? readonly string[]
					: D extends { readonly type: "string" }
						? string
						: | boolean
							| string
							| readonly string[]
							| readonly boolean[];

type OptionValues<O extends readonly OptionDescriptor[]> = {
	readonly [D in O[number] as D["name"]]?: OptionValue<D>;
};

const COLOR_CHOICES = ["auto", "always", "never"] as const;

export const ColorOption = {
	name: "color",
	type: "string",
	values: COLOR_CHOICES,
	placeholder: "color",
	default: "auto",
	description: "Whether to colour the output.",
} as const satisfies OptionDescriptor;

export const GlobalOptions = [
	ColorOption,
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

export interface CommandLine<
	O extends readonly OptionDescriptor[] = readonly OptionDescriptor[],
> {
	readonly positionals: readonly string[];
	readonly shortHelp?: true;
	readonly asksForNothing?: true;
	readonly options: OptionValues<O> & OptionValues<typeof GlobalOptions>;
}

interface ParsedCli {
	readonly command: string;
	readonly line: CommandLine;
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

function beforeSeparator(
	args: readonly string[],
	rewrite: (arg: string) => string
): string[] {
	const end = args.indexOf("--");
	const own = end === -1 ? args : args.slice(0, end);
	const rewritten = own.map(rewrite);
	return end === -1 ? rewritten : [...rewritten, ...args.slice(end)];
}

function withShortValues(
	args: readonly string[],
	options: readonly OptionDescriptor[]
): string[] {
	return beforeSeparator(args, (arg) => {
		const short = /^-([^-=])=(.*)$/s.exec(arg);
		const option = options.find(
			({ short: letter, type }) =>
				letter === short?.[1] && type === "string"
		);
		return short && option ? `--${option.name}=${short[2]}` : arg;
	});
}

function withAliases(
	args: readonly string[],
	options: readonly OptionDescriptor[]
): string[] {
	return beforeSeparator(args, (arg) => {
		const alias = /^--([^=]+)(=.*)?$/s.exec(arg);
		const option = options.find(({ aliases }) =>
			aliases?.includes(alias?.[1] ?? "")
		);
		return alias && option ? `--${option.name}${alias[2] ?? ""}` : arg;
	});
}

function namedCommand(positionals: readonly string[]): string {
	return positionals[0] ?? HELP_COMMAND;
}

function asksForHelpOrVersion(values: {
	version?: unknown;
	help?: unknown;
}): boolean {
	return Boolean(values.version || values.help);
}

export const flagName = (
	option: Pick<OptionDescriptor, "name" | "negation">
): string => (option.negation === "only" ? `no-${option.name}` : option.name);

const isNegated = (token: OptionToken): boolean =>
	token.rawName.startsWith("--no-") && token.rawName !== `--${token.name}`;

function unknownOption(
	{ name, rawName }: OptionToken,
	options: readonly OptionDescriptor[],
	owners: readonly string[],
	command: string | undefined
): UsageError {
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

/** Options a line may give more than once, as Rojo takes `--help` twice. */
const REPEATABLE: ReadonlySet<string> = new Set(["help", "version"]);

/**
 * Node's wording varies by version and talks about positionals, so options are
 * checked here.
 */
function findOptionProblem(
	tokens: NonNullable<Token>,
	options: readonly OptionDescriptor[],
	ownersOf: (name: string, negated: boolean) => string[],
	command: string | undefined
): UsageError | undefined {
	const given = new Set<string>();
	for (const token of tokens) {
		if (token.kind !== "option") continue;
		const option = options.find(({ name }) => name === token.name);
		if (
			option?.type === "boolean" &&
			option.negation !== "also" &&
			isNegated(token) !== (option.negation === "only")
		)
			return new UsageError(
				`'${token.rawName}' is the default; only '--${flagName(option)}' changes it.`
			);
		if (!option || (isNegated(token) && option.type !== "boolean")) {
			return unknownOption(
				token,
				options,
				ownersOf(token.name, isNegated(token)),
				command
			);
		}
		const spelled = isNegated(token)
			? `--no-${option.name}`
			: `--${option.name}`;
		if (!option.multiple && !REPEATABLE.has(option.name)) {
			if (given.has(spelled))
				return new UsageError(
					option.type === "string"
						? `'${spelled}' was given more than once, but takes one value.`
						: `'${spelled}' was given more than once, but can be given only once.`
				);
			given.add(spelled);
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
	}
	return undefined;
}

export function parseArgs(
	args: string[],
	optionsFor: (command?: string) => readonly OptionDescriptor[],
	commands: readonly string[]
): Result<ParsedCli, Error> {
	const allOptions = optionsFor();
	const ownersOf = (name: string, negated: boolean) =>
		commands
			.filter((owner) =>
				optionsFor(owner).some(
					(option) =>
						option.name === name &&
						(negated
							? option.negation !== undefined
							: option.negation !== "only")
				)
			)
			.sort();
	const named = tokenize(
		withShortValues(args, allOptions),
		allOptions
	).tokens?.find((token) => token.kind === "positional")?.value;
	const typed = withShortValues(
		withAliases(
			args,
			named !== undefined && commands.includes(named)
				? optionsFor(named)
				: []
		),
		allOptions
	);
	const { values, tokens } = tokenize(typed, allOptions);
	const terminator = tokens.find(
		(token) => token.kind === "option-terminator"
	);
	const positionals = tokens.flatMap((token) =>
		token.kind === "positional" &&
		(!terminator || token.index < terminator.index)
			? [token.value]
			: []
	);
	const afterTerminator = terminator ? typed.slice(terminator.index + 1) : [];
	if (positionals.length === 0 && afterTerminator.length > 0)
		return err(
			new UsageError(
				`'${afterTerminator[0]}' comes after '--', which ends the options, so it can't be the command.`,
				"Remove the '--' before it."
			)
		);
	const commandNamed = namedCommand(positionals);
	const runsHelp = positionals.length === 0 || asksForHelpOrVersion(values);
	const helpRawNames = tokens.flatMap((token) =>
		token.kind === "option" && token.name === "help" ? [token.rawName] : []
	);
	const shortHelp =
		helpRawNames.length > 0 &&
		helpRawNames.every((rawName) => rawName === "-h");

	if (commands.includes(commandNamed)) {
		const problem = findOptionProblem(
			tokens,
			optionsFor(commandNamed),
			ownersOf,
			positionals.length > 0 ? commandNamed : undefined
		);
		if (problem) return err(problem);
	}
	if (values.verbose && values.quiet) {
		return err(new UsageError("--verbose can't be combined with --quiet."));
	}
	return ok({
		command: runsHelp ? HELP_COMMAND : commandNamed,
		line: {
			positionals: [
				...(runsHelp ? positionals.slice(0, 1) : positionals.slice(1)),
				...afterTerminator,
			],
			...(shortHelp && { shortHelp: true as const }),
			...(positionals.length === 0 &&
				!asksForHelpOrVersion(values) && {
					asksForNothing: true as const,
				}),
			options: values as CommandLine["options"],
		},
	});
}

const ownArgs = (argv: readonly string[]): readonly string[] => {
	const end = argv.indexOf("--");
	return end === -1 ? argv : argv.slice(0, end);
};

export function hasFlag(
	argv: readonly string[],
	option: OptionDescriptor
): boolean {
	return ownArgs(argv).includes(`--${option.name}`);
}

export function choiceIn<V extends string>(
	argv: readonly string[],
	option: { readonly name: string; readonly values: readonly V[] }
): V | undefined {
	const own = ownArgs(argv);
	const flag = `--${option.name}`;
	for (let index = own.length - 1; index >= 0; index--) {
		const value =
			own[index] === flag
				? own[index + 1]
				: own[index].startsWith(`${flag}=`)
					? own[index].slice(flag.length + 1)
					: undefined;
		const choice = option.values.find((one) => one === value);
		if (choice) return choice;
	}
	return undefined;
}
