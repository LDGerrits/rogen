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

function parseStrict(args: string[], options: readonly OptionDescriptor[]) {
	const { values, positionals } = nodeParseArgs({
		args,
		options: toOptionTable(options),
		allowPositionals: true,
		strict: true,
	});

	let command = "build";
	if (values.version) command = "version";
	else if (values.help) command = "help";
	else if (positionals.length > 0) command = positionals[0].toLowerCase();
	else positionals.push(command);

	return { command, options: { ...values, _: positionals } as ParsedArgs };
}

/**
 * Finds the command with every known option (`optionsFor(undefined)`), then
 * parses again with only the options that command accepts.
 */
export function parseArgs(
	args: string[],
	optionsFor: (command?: string) => readonly OptionDescriptor[]
): Result<ParsedCli, Error> {
	try {
		const { command } = parseStrict(args, optionsFor());
		const parsed = parseStrict(args, optionsFor(command));
		if (parsed.options.verbose && parsed.options.quiet) {
			return err(new Error("--verbose can't be combined with --quiet."));
		}
		return ok(parsed);
	} catch (error) {
		return err(ErrorUtils.fromUnknown(error));
	}
}

/** Whether `flag` was typed before any `--`, however the rest of the line parses. */
export function hasFlag(argv: readonly string[], flag: string): boolean {
	const end = argv.indexOf("--");
	return (end === -1 ? argv : argv.slice(0, end)).includes(flag);
}
