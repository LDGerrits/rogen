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
	config?: string[];
	"out-file"?: string;
	"sync-dir"?: string;
	template?: string;
	tag?: string[];
	"no-tag"?: string[];
	"show-config"?: boolean;
}

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
