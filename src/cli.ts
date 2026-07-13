import { parseArgs } from "util";
import { CliArgs } from "./types.js";

export function printHelp(): void {
	console.log(`
Rogen - A tool for feature-based folder structures with Rojo.

Usage:
  rogen [options]

Actions:
  -h, --help            Show this help menu.
  -i, --init            Generate a default .rogen.json config file.
  -w, --watch           Watch the source directory and regenerate automatically.

Overrides:
  -c, --config <path>   Specify a custom Rogen config file path.
  -m, --mode <mode>     Specify the target mode (luau, ts, darklua, or custom).
  -s, --source <path>   Override the directory containing uncompiled code.
  -t, --template <path> Specify a path to a base Rojo tree JSON template.
  -b, --build <path>    Override the output directory for transpiled code.
  -o, --output <path>   Override the final generated Rojo project file path.
	`);
}

export function parseCliArgs(args: string[] = process.argv.slice(2)): CliArgs {
	const options = {
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

	const { values } = parseArgs({ args, options, strict: false });
	return values as CliArgs;
}