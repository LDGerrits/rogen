import { parseArgs } from "util";
import { CliArgs } from "./types.js";

export function printHelp(): void {
	console.log(`
Rogen - A tool for feature-based folder structures with Rojo.

Usage:
  rogen [options]

Options:
  -h, --help            Show this help menu
  -i, --init            Generate a default .rogen.json config file
  -w, --watch           Watch the source directory for changes and regenerate automatically
  -c, --config <path>   Specify a custom Rogen config file path
  -m, --mode <mode>     Specify the mode to run (luau, ts, darklua, or <custom_mode>)
  -s, --source <path>   Override the directory containing your uncompiled code
  -t, --template <path> Specify a path to a JSON file containing your base Rojo tree
  -b, --build <path>    Override the directory where your compiled/transpiled code lands
  -o, --output <path>   Override the name and destination of the final generated Rojo project file
  -k, --keepRouteNames  Do not strip routing prefixes or suffixes (e.g., server, client) from names
	`);
}

export function parseCliArgs(args: string[] = process.argv.slice(2)): CliArgs {
	const options = {
		help: { type: "boolean" as const, short: "h" },
		init: { type: "boolean" as const, short: "i" },
		config: { type: "string" as const, short: "c" },
		mode: { type: "string" as const, short: "m" },
		source: { type: "string" as const, short: "s", multiple: true },
		template: { type: "string" as const, short: "t" },
		output: { type: "string" as const, short: "o" },
		build: { type: "string" as const, short: "b" },
		watch: { type: "boolean" as const, short: "w" },
		keepRouteNames: { type: "boolean" as const, short: "k" }
	};

	const { values } = parseArgs({ args, options, strict: false });
	return values as CliArgs;
}