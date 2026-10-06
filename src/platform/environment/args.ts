import { parseArgs as nodeParseArgs } from "util";
import { Result, err, ok } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";
import { closestMatch, joinedWithAnd } from "../../base/strings.js";

export interface OptionDescriptor {
	readonly name: string;
	readonly short?: string;
	readonly type: "string" | "boolean";
	readonly multiple?: boolean;
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
		short: "v",
		type: "boolean",
		description: "Print the version.",
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
		name: "no-input",
		type: "boolean",
		description: "Never ask, and print plain lines.",
	},
] as const satisfies readonly OptionDescriptor[];

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

/** The command a line runs, and whether its first positional named it. */
function commandOf(
	values: { version?: unknown; help?: unknown },
	positionals: readonly string[]
): { readonly command: string; readonly named: boolean } {
	if (values.version) return { command: "version", named: false };
	if (values.help) return { command: "help", named: false };
	return positionals.length > 0
		? { command: positionals[0].toLowerCase(), named: true }
		: { command: "build", named: false };
}

function unknownOption(
	{ name, rawName }: OptionToken,
	options: readonly OptionDescriptor[],
	owners: readonly string[],
	command: string
): string {
	const help = `Run 'rogen help ${command}' to see what ${command} accepts.`;
	if (owners.length > 0)
		return `${command} doesn't take '${rawName}'. ${joinedWithAnd(owners)} ${owners.length === 1 ? "does" : "do"}.`;
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
	command: string
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
 * checks the line against the options that command accepts. A line for a
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
		const { command, named } = commandOf(values, positionals);

		if (commands.includes(command)) {
			const problem = findOptionProblem(
				tokens ?? [],
				optionsFor(command),
				ownersOf,
				command
			);
			if (problem) return err(new Error(problem));
		}
		if (values.verbose && values.quiet) {
			return err(new Error("--verbose can't be combined with --quiet."));
		}
		return ok({
			command,
			line: {
				positionals: named ? positionals.slice(1) : positionals,
				options: values as CommandLine["options"],
			},
		});
	} catch (error) {
		return err(ErrorUtils.fromUnknown(error));
	}
}

/** Whether `flag` was typed before any `--`, however the rest of the line parses. */
export function hasFlag(argv: readonly string[], flag: string): boolean {
	const end = argv.indexOf("--");
	return (end === -1 ? argv : argv.slice(0, end)).includes(flag);
}
