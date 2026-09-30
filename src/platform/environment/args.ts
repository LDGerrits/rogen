import { parseArgs as nodeParseArgs } from "util";
import { Result, err, ok } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";

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
	tag?: string[];
	"no-tag"?: string[];
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

const TagOption: OptionDescriptor = {
	name: "tag",
	short: "t",
	type: "string",
	multiple: true,
	description: "Turns a tag on.",
};

const NoTagOption: OptionDescriptor = {
	name: "no-tag",
	short: "T",
	type: "string",
	multiple: true,
	description: "Turns a tag off.",
};

/** The flags that pick the configs a command reads and which tags are on in them. */
export const ConfigSelectionOptions: readonly OptionDescriptor[] = [
	AllOption,
	ConfigPathOption,
	TagOption,
	NoTagOption,
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
	TagOption,
	NoTagOption,
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

/** Node's own wording varies by version and talks about positionals, so the options are checked here. */
function findOptionProblem(
	tokens: NonNullable<Token>,
	options: readonly OptionDescriptor[],
	command: string
): string | undefined {
	for (const token of tokens) {
		if (token.kind !== "option") continue;
		const option = options.find(({ name }) => name === token.name);
		if (!option) {
			return `Unknown option '${token.rawName}'. Run 'rogen help ${command}' to see what ${command} accepts.`;
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
	isCommand: (command: string) => boolean
): Result<ParsedCli, Error> {
	try {
		const { values, positionals, tokens } = tokenize(args, optionsFor());
		const command = commandOf(values, positionals);
		if (command === "build" && positionals.length === 0)
			positionals.push(command);

		if (isCommand(command)) {
			const problem = findOptionProblem(
				tokens ?? [],
				optionsFor(command),
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
