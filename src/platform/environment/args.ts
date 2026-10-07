import { parseArgs as nodeParseArgs } from "util";
import { Result, err, ok } from "../../base/result.js";
import { ErrorUtils, UsageError } from "../../base/errors.js";
import { closestMatch, joinedWithAnd } from "../../base/strings.js";

export interface OptionDescriptor {
	readonly name: string;
	readonly short?: string;
	readonly type: "string" | "boolean";
	readonly multiple?: boolean;
	/** What help writes for a string option's value: `--out-file <path>`. Defaults to `value`. */
	readonly placeholder?: string;
	readonly description: string;
}

/** An option's value; one whose descriptor isn't known exactly may hold any. */
type OptionValue<D extends OptionDescriptor> = D extends {
	readonly type: "boolean";
}
	? boolean
	: D extends { readonly multiple: true }
		? readonly string[]
		: D extends { readonly type: "string" }
			? string
			: boolean | string | readonly string[];

/** The values a line gives the options of `O`, keyed by name; an option not given is absent. */
export type OptionValues<O extends readonly OptionDescriptor[]> = {
	readonly [D in O[number] as D["name"]]?: OptionValue<D>;
};

/** The options every command takes. */
export const GlobalOptions = [
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
		description: "Print debug output.",
	},
	{
		name: "quiet",
		short: "q",
		type: "boolean",
		description: "Only print errors.",
	},
] as const satisfies readonly OptionDescriptor[];

/** The command that answers `--help`, `--version` and a bare line. */
export const HELP_COMMAND = "help";

/** For the commands whose answer a program reads. */
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
	readonly options: OptionValues<O> & OptionValues<typeof GlobalOptions>;
}

export interface ParsedCli {
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

/** `command` is `undefined` when the line names none. */
function unknownOption(
	{ name, rawName }: OptionToken,
	options: readonly OptionDescriptor[],
	owners: readonly string[],
	command: string | undefined
): string {
	const help = command
		? `Run 'rogen ${HELP_COMMAND} ${command}' to see what ${command} accepts.`
		: `Run 'rogen ${HELP_COMMAND}' to see the commands.`;
	if (owners.length > 0) {
		const many = owners.length > 1;
		return command
			? `${command} doesn't take '${rawName}'. ${joinedWithAnd(owners)} ${many ? "do" : "does"}.`
			: `'${rawName}' goes after a command: ${joinedWithAnd(owners)} ${many ? "take" : "takes"} it.`;
	}
	const suggestion = rawName.startsWith("--")
		? closestMatch(
				name,
				options.map((option) => option.name)
			)
		: undefined;
	return suggestion
		? `Unknown option '${rawName}'. Did you mean '--${suggestion}'?`
		: `Unknown option '${rawName}'. ${help}`;
}

/** Node's own wording varies by version and talks about positionals, so the options are checked here. `ownersOf` names the commands that take an option. */
function findOptionProblem(
	tokens: NonNullable<Token>,
	options: readonly OptionDescriptor[],
	ownersOf: (name: string) => string[],
	command: string | undefined
): string | undefined {
	for (const token of tokens) {
		if (token.kind !== "option") continue;
		const option = options.find(({ name }) => name === token.name);
		if (!option) {
			return unknownOption(token, options, ownersOf(token.name), command);
		}
		if (option.type === "boolean" && token.value !== undefined) {
			return `Option '${token.rawName}' is a flag and takes no value.`;
		}
		const missing =
			token.value === undefined ||
			(!token.inlineValue && token.value.startsWith("-"));
		if (option.type === "string" && missing) {
			return `Option '${token.rawName}' needs a value.`;
		}
	}
	return undefined;
}

/**
 * Finds the command with every known option (`optionsFor(undefined)`), then
 * checks the line against the options of the command it names. A line for a
 * command that doesn't exist is returned unchecked, for the command service to
 * report.
 */
export function parseArgs(
	args: string[],
	optionsFor: (command?: string) => readonly OptionDescriptor[],
	commands: readonly string[]
): Result<ParsedCli, Error> {
	try {
		const allOptions = optionsFor();
		const ownersOf = (name: string) =>
			commands
				.filter((owner) =>
					optionsFor(owner).some((option) => option.name === name)
				)
				.sort();
		const { values, positionals, tokens } = tokenize(args, allOptions);
		const { runs, names, consumesWord } = commandOf(values, positionals);

		if (commands.includes(names)) {
			const problem = findOptionProblem(
				tokens ?? [],
				optionsFor(names),
				ownersOf,
				positionals.length > 0 ? names : undefined
			);
			if (problem) return err(new UsageError(problem));
		}
		if (values.verbose && values.quiet) {
			return err(
				new UsageError("--verbose can't be combined with --quiet.")
			);
		}
		return ok({
			command: runs,
			line: {
				positionals: consumesWord ? positionals.slice(1) : positionals,
				options: values as CommandLine["options"],
			},
		});
	} catch (error) {
		return err(ErrorUtils.fromUnknown(error));
	}
}

/** Whether `option` was typed by its long name before any `--`, however the rest of the line parses. */
export function hasFlag(
	argv: readonly string[],
	option: OptionDescriptor
): boolean {
	const end = argv.indexOf("--");
	return (end === -1 ? argv : argv.slice(0, end)).includes(
		`--${option.name}`
	);
}
