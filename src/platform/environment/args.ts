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
	mode?: string[];
	source?: string[];
	env?: string[];
	template?: string;
	build?: string;
	output?: string;
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
		mode: { type: "string", short: "m", multiple: true },
		source: { type: "string", short: "s", multiple: true },
		env: { type: "string", short: "e", multiple: true },
		template: { type: "string", short: "t" },
		build: { type: "string", short: "b" },
		output: { type: "string", short: "o" },
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

		const parsedArgs: ParsedArgs = {
			...values,
			_: positionals || [],
		};

		return ok({ command, options: parsedArgs });
	} catch (error) {
		const rawError = error as Record<string, unknown>;
		if (rawError.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
			const cleanMsg = (error as Error).message.replace(
				/^TypeError \[ERR_PARSE_ARGS_UNKNOWN_OPTION\]:\s*/,
				""
			);
			return err(
				new ParseArgumentError(
					`${cleanMsg}\nRun 'rogen --help' to see available commands.`,
					rawError.code as string
				)
			);
		}
		return err(ErrorUtils.fromUnknown(error));
	}
}

class ParseArgumentError extends Error {
	constructor(
		message: string,
		public readonly code: string
	) {
		super(message);
		this.name = "ParseArgumentError";
	}
}
