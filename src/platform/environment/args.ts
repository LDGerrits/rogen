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

export interface ParsedArgs {
	_: string[];
	help?: boolean;
	version?: boolean;
	verbose?: boolean;
	quiet?: boolean;
	"no-input"?: boolean;
	json?: boolean;
	all?: boolean;
	config?: string[];
	"out-file"?: string;
	"sync-dir"?: string;
	template?: string;
	variant?: string[];
	"no-variant"?: string[];
}

/** The options every command takes. */
export const GlobalOptions: readonly OptionDescriptor[] = [
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
];

/** For the commands whose answer a program reads. */
export const JsonOption: OptionDescriptor = {
	name: "json",
	type: "boolean",
	description: "Print one JSON document instead of text.",
};

const AllOption: OptionDescriptor = {
	name: "all",
	type: "boolean",
	description: "Every config in the working directory.",
};

const ConfigPathOption: OptionDescriptor = {
	name: "config",
	short: "c",
	type: "string",
	multiple: true,
	description: "An explicit config path.",
};

const VariantOption: OptionDescriptor = {
	name: "variant",
	type: "string",
	multiple: true,
	description: "Turns a variant on.",
};

const NoVariantOption: OptionDescriptor = {
	name: "no-variant",
	type: "string",
	multiple: true,
	description: "Turns a variant off.",
};

/** The flags that pick the configs a command reads and which variants are on in them. */
export const ConfigSelectionOptions: readonly OptionDescriptor[] = [
	AllOption,
	ConfigPathOption,
	VariantOption,
	NoVariantOption,
];

/** The flags that pick, or override, the configs a command builds. */
export const ConfigOptions: readonly OptionDescriptor[] = [
	AllOption,
	ConfigPathOption,
	{
		name: "out-file",
		short: "o",
		type: "string",
		description: "Overrides outFile.",
	},
	{
		name: "sync-dir",
		short: "s",
		type: "string",
		description: "Overrides syncDir.",
	},
	{
		name: "template",
		type: "string",
		description: "Overrides template.",
	},
	VariantOption,
	NoVariantOption,
];

export interface ParsedCli {
	command: string;
	options: ParsedArgs;
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

function commandOf(
	values: { version?: unknown; help?: unknown },
	positionals: string[]
): string {
	if (values.version) return "version";
	if (values.help) return "help";
	return positionals.length > 0 ? positionals[0].toLowerCase() : "build";
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
		const command = commandOf(values, positionals);
		if (command === "build" && positionals.length === 0)
			positionals.push(command);

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
			options: { ...values, _: positionals } as ParsedArgs,
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
