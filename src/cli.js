const { parseArgs } = require("util");

function printHelp() {
	console.log(`
Rogen - A tool for feature-based folder structures with Rojo.

Usage:
  rogen [options]

Options:
  -h, --help            Show this help menu
  -i, --init            Generate a default .rogen.json config file
  -w, --watch           Watch the source directory for changes and regenerate automatically
  -c, --config <path>   Specify a custom Rogen config file path
  -m, --mode <mode>     Specify the mode to run (luau, ts, or darklua)
  -s, --source <path>   Override the directory containing your uncompiled code
  -t, --template <path> Specify a path to a JSON file containing your base Rojo blueprint
  -b, --build <path>    Override the directory where your compiled/transpiled code lands
  -o, --output <path>   Override the name and destination of the final generated Rojo project file
  -k, --keepSuffixes    Do not strip routing suffixes (e.g., server, client) from names
	`);
}

function parseCliArgs(args = process.argv.slice(2)) {
	const options = {
		help: { type: "boolean", short: "h" },
		init: { type: "boolean", short: "i" },
		config: { type: "string", short: "c" },
		mode: { type: "string", short: "m" },
		source: { type: "string", short: "s", multiple: true },
		template: { type: "string", short: "t" },
		output: { type: "string", short: "o" },
		build: { type: "string", short: "b" },
		watch: { type: "boolean", short: "w" },
		keepSuffixes: { type: "boolean", short: "k" }
	};

	const { values } = parseArgs({ args, options, strict: false });
	return values;
}

module.exports = { printHelp, parseCliArgs };