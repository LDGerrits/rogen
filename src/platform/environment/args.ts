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
	config?: string;
	source?: string[];
	env?: string[];
	build?: string;
	output?: string;
	mode?: string[];
	verbose?: boolean;
	quiet?: boolean;
	trace?: boolean;
}

export interface ParsedCli {
	command: string;
	options: ParsedArgs;
}

export function parseArgs(
	args: string[],
	options: readonly OptionDescriptor[]
): Result<ParsedCli, Error> {
	const optionTable = Object.fromEntries(
		options.map(({ name, short, type, multiple }) => [
			name,
			{ type, ...(short && { short }), ...(multiple && { multiple }) },
		])
	);

	try {
		const { values, positionals } = nodeParseArgs({
			args,
			options: optionTable,
			allowPositionals: true,
			strict: true,
		});

		let command = "help";
		if (values.version) command = "version";
		else if (values.help) command = "help";
		else if (positionals.length > 0) command = positionals[0].toLowerCase();

		return ok({ command, options: { ...values, _: positionals || [] } });
	} catch (error) {
		return err(ErrorUtils.fromUnknown(error));
	}
}
