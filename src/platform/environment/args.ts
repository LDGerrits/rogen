import { parseArgs as nodeParseArgs } from "util";
import { Result, err, ok } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";

export interface ParsedArgs {
	_: string[];
	help?: boolean;
	version?: boolean;
	init?: boolean;
	watch?: boolean;
	config?: string;
	profile?: string;
	source?: string[];
	env?: string[];
	verbose?: boolean;
	quiet?: boolean;
	trace?: boolean;
}

export interface ParsedCli {
	command: string;
	options: ParsedArgs;
}

export function parseArgs(args: string[]): Result<ParsedCli, Error> {
	const options = {
		help: { type: "boolean", short: "h" },
		version: { type: "boolean", short: "v" },
		init: { type: "boolean", short: "i" },
		watch: { type: "boolean", short: "w" },
		config: { type: "string", short: "c" },
		profile: { type: "string", short: "p" },
		source: { type: "string", short: "s", multiple: true },
		env: { type: "string", short: "e", multiple: true },
		verbose: { type: "boolean" },
		quiet: { type: "boolean", short: "q" },
		trace: { type: "boolean" },
	} as const;

	try {
		const { values, positionals } = nodeParseArgs({
			args: args,
			options,
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
