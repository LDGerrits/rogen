import { parseArgs as nodeParseArgs } from "util";
import { Result, ok, err } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";

export interface CliArgs {
	// Command
	help?: boolean;
	version?: boolean;
	init?: boolean;
	watch?: boolean;
	// Overrides
	config?: string;
	mode?: string[];
	source?: string[];
	env?: string[];
	template?: string;
	build?: string;
	output?: string;
	// Log levels
	verbose?: boolean;
	quiet?: boolean;
	trace?: boolean;
}

export function parseArgs(args: string[]): Result<CliArgs, Error> {
	const options = {
		help: { type: "boolean" as const, short: "h" },
		version: { type: "boolean" as const, short: "v" },
		init: { type: "boolean" as const, short: "i" },
		watch: { type: "boolean" as const, short: "w" },
		config: { type: "string" as const, short: "c" },
		mode: { type: "string" as const, short: "m", multiple: true },
		source: { type: "string" as const, short: "s", multiple: true },
		env: { type: "string" as const, short: "e", multiple: true },
		template: { type: "string" as const, short: "t" },
		build: { type: "string" as const, short: "b" },
		output: { type: "string" as const, short: "o" },
		verbose: { type: "boolean" as const },
		quiet: { type: "boolean" as const, short: "q" },
		trace: { type: "boolean" as const },
	};

	try {
		const { values, positionals } = nodeParseArgs({
			args,
			options,
			allowPositionals: true,
			strict: true,
		});

		const parsedArgs = values as CliArgs;

		// Subcommand positional mappings
		if (positionals.length > 0) {
			const subcommand = positionals[0].toLowerCase();
			if (subcommand === "init") {
				parsedArgs.init = true;
			} else if (subcommand === "watch") {
				parsedArgs.watch = true;
			} else if (subcommand === "help") {
				parsedArgs.help = true;
			} else if (subcommand === "version") {
				parsedArgs.version = true;
			} else {
				return err(
					new Error(
						`Unknown subcommand or option "${positionals[0]}".\nRun 'rogen --help' to see a list of available commands.`
					)
				);
			}
		}

		return ok(parsedArgs);
	} catch (error) {
		const normalizedError = ErrorUtils.fromUnknown(error);
		const errCode = (normalizedError as unknown as Record<string, unknown>)
			.code;

		if (
			errCode === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ||
			normalizedError.message.includes("Unknown option")
		) {
			const cleanMsg = normalizedError.message.replace(
				/^TypeError \[ERR_PARSE_ARGS_UNKNOWN_OPTION\]:\s*/,
				""
			);
			return err(
				new Error(
					`${cleanMsg}\nRun 'rogen --help' to see a list of available commands and options.`
				)
			);
		}

		return err(normalizedError);
	}
}
