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

export const GlobalOptions = [
	{ name: "help", short: "h", type: "boolean", description: "Print help." },
	{
		name: "version",
		short: "v",
		type: "boolean",
		description: "Print the version.",
	},
	{
		name: "config",
		short: "c",
		type: "string",
		description: "Path to the config file.",
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
		name: "trace",
		type: "boolean",
		description: "Print trace output.",
	},
] as const satisfies readonly OptionDescriptor[];

type OptionValue<O extends OptionDescriptor> = O["type"] extends "boolean"
	? boolean
	: O extends { readonly multiple: true }
		? string[]
		: string;

/** The parsed values of a list declared `as const`, keyed by option name. */
export type OptionValues<T extends readonly OptionDescriptor[]> = {
	[O in T[number] as O["name"]]?: OptionValue<O>;
};

export type ParsedArgs = OptionValues<typeof GlobalOptions> & {
	_: string[];
};

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

	let command = "help";
	if (values.version) command = "version";
	else if (values.help) command = "help";
	else if (positionals.length > 0) command = positionals[0].toLowerCase();

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
		return ok(parseStrict(args, optionsFor(command)));
	} catch (error) {
		return err(ErrorUtils.fromUnknown(error));
	}
}
