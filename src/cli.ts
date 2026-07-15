import { parseArgs } from "util";
import { CliArgs } from "./types.js";

interface CliArg {
	type: "string" | "boolean";
	short?: string;
	multiple?: boolean;
}

export function printHelp(): void {
	console.log(`
Rogen - A tool for feature-based folder structures with Rojo.

Usage:
  rogen [options]

Options:
  -h, --help            Show this help menu.
  -i, --init            Generate a default .rogen.json config file.
  -w, --watch           Watch the source directory and regenerate automatically.

  -c, --config <path>   Specify a custom Rogen config file path.
  -m, --mode <mode>     Specify the target mode (luau, ts, darklua, or custom).
  -s, --source <path>   Override the directory containing uncompiled code.
  -t, --template <path> Specify a path to a base Rojo tree JSON template.
  -b, --build <path>    Override the output directory for transpiled code.
  -o, --output <path>   Override the final generated Rojo project file path.
	`);
}

export function parseCliArgs(args: string[] = process.argv.slice(2)): CliArgs {
	const options: Record<keyof CliArgs, CliArg> = {
		help: { type: "boolean" as const, short: "h" },
		init: { type: "boolean" as const, short: "i" },
		watch: { type: "boolean" as const, short: "w" },
		config: { type: "string" as const, short: "c" },
		mode: { type: "string" as const, short: "m" },
		source: { type: "string" as const, short: "s", multiple: true },
		template: { type: "string" as const, short: "t" },
		build: { type: "string" as const, short: "b" },
		output: { type: "string" as const, short: "o" },
	};

	try {
		const { values } = parseArgs({ args, options, strict: true });
		return values as CliArgs;
	} catch (error: unknown) {
		let errCode: string | undefined;
		let errMsg = String(error);

		// Narrow down to a generic object
		if (typeof error === "object" && error !== null) {
			const errObj = error as Record<string, unknown>;
			errCode = typeof errObj.code === "string" ? errObj.code : undefined;
			errMsg =
				typeof errObj.message === "string"
					? errObj.message
					: String(error);
		}

		// Duck type check due to instanceof issues using Jest
		if (
			errCode === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ||
			errMsg.includes("Unknown option")
		) {
			const cleanMsg = errMsg.replace(
				/^TypeError \[ERR_PARSE_ARGS_UNKNOWN_OPTION\]:\s*/,
				""
			);

			console.error(`\n❌ CLI Error: ${cleanMsg}`);
			console.error(
				`Run 'rogen --help' to see a list of available commands and flags.\n`
			);
			process.exit(1);
		}

		console.error(`\n❌ CLI Error: ${errMsg}\n`);
		process.exit(1);
	}
}
