import { parseArgs } from "util";
import { CliArgs } from "./types.js";
import { Logger } from "./logger.js";

interface CliArg {
	type: "string" | "boolean";
	short?: string;
	multiple?: boolean;
}

export function printHelp(logger?: Logger): void {
	const helpText = `
Rogen - A tool for feature-based folder structures with Rojo

Usage:
  rogen [command] [options]

Commands:
  init                  Generate a .rogen.json config file
  watch                 Watch the source and generate automatically

Options:
  -c, --config <path>   Specify custom config file
  -t, --template <path> Specify path to the Rojo tree JSON template
  -f, --flag <flag>     Activate environment flags
  -m, --mode <mode>     Override modes (luau, ts, darklua, or custom)
  -s, --source <path>   Override the directory containing uncompiled code
  -b, --build <path>    Override output directory for transpiled code
  -o, --output <path>   Override path of Rojo project file
  -h, --help            Print help
  -v, --version         Print version
	`;

	if (logger) {
		logger.info(helpText);
	} else {
		console.log(helpText);
	}
}

export function parseCliArgs(
	args: string[] = process.argv.slice(2),
	logger?: Logger
): CliArgs {
	const options: Record<keyof CliArgs, CliArg> = {
		help: { type: "boolean" as const, short: "h" },
		version: { type: "boolean" as const, short: "v" },
		init: { type: "boolean" as const, short: "i" },
		watch: { type: "boolean" as const, short: "w" },
		config: { type: "string" as const, short: "c" },
		mode: { type: "string" as const, short: "m", multiple: true },
		source: { type: "string" as const, short: "s", multiple: true },
		flag: { type: "string" as const, short: "f", multiple: true },
		template: { type: "string" as const, short: "t" },
		build: { type: "string" as const, short: "b" },
		output: { type: "string" as const, short: "o" },
	};

	try {
		const { values, positionals } = parseArgs({
			args,
			options,
			allowPositionals: true,
			strict: true,
		});

		const parsedArgs = values as CliArgs;
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
				const errorMsg = `unknown subcommand or option "${positionals[0]}".\nRun 'rogen --help' to see a list of available commands.`;
				if (logger) {
					logger.error(errorMsg);
				} else {
					console.error(errorMsg);
				}
				process.exit(1);
			}
		}

		return parsedArgs;
	} catch (error: unknown) {
		let errCode: string | undefined;
		let errMsg = String(error);

		if (typeof error === "object" && error !== null) {
			const errObj = error as Record<string, unknown>;
			errCode = typeof errObj.code === "string" ? errObj.code : undefined;
			errMsg =
				typeof errObj.message === "string"
					? errObj.message
					: String(error);
		}

		if (
			errCode === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ||
			errMsg.includes("Unknown option")
		) {
			const cleanMsg = errMsg.replace(
				/^TypeError \[ERR_PARSE_ARGS_UNKNOWN_OPTION\]:\s*/,
				""
			);
			const errorMsg = `${cleanMsg}\nRun 'rogen --help' to see a list of available commands and options.`;
			if (logger) {
				logger.error(errorMsg);
			} else {
				console.error(errorMsg);
			}
			process.exit(1);
		}

		if (logger) {
			logger.error(errMsg);
		} else {
			console.error(errMsg);
		}
		process.exit(1);
	}
}
