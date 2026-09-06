import { Command } from "../command.js";
import { LogService } from "../../platform/log/log-service.js";
import { Result, ok } from "../../base/result.js";

export class HelpCommand implements Command {
	constructor(private readonly logService: LogService) {}

	execute(): Result<void, Error> {
		this.logService.info(`
Rogen - Feature-based architecture for Roblox

Usage:
  rogen <command> [options]

Commands:
  build [profiles...]      Build targeted profiles (default: all)
  watch [profiles...]      Watch sources and rebuild on change
  init [name]              Initialize a workspace config (creates <name>.rogen.json)

Build & Routing options:
  -p, --project <path>     Override base Rojo project file template
  -s, --src-dir <path>     Override or add source directory (repeatable)
  -C, --condition <name>   Activate condition variant (repeatable)
  -i, --ignore <glob>      Add ignore glob pattern (repeatable)
  -n, --dry-run            Simulate build and print the resolved Rojo project without saving

Output options (Single-profile only):
  -d, --out-dir <path>     Override transpilation/artifact output directory
  -o, --out-file <path>    Override generated Rojo project filename

Init options:
  -f, --force              Overwrite existing configuration file without prompting

Logging options:
  -q, --quiet              Suppress all non-error output
  -v, --verbose            Print detailed compilation and routing resolution steps
      --trace              Print exhaustive engine internals, file reconciliation, and timing

Global options:
  -c, --config <path>      Path to custom configuration file
  -h, --help               Print help (or 'rogen help <command>' for details)
  -V, --version            Print version information

Examples:
  $ rogen watch dev                  # Watch the 'dev' profile and live-update the Rojo project
  $ rogen watch dev -C mock          # Watch 'dev' and additionally activate the 'mock' condition
  $ rogen build luau darklua         # Compile both 'luau' and 'darklua' profiles in sequence
  $ rogen build prod --dry-run       # Simulate a 'prod' build and inspect the generated project tree
  $ rogen init lobby --force         # Force initialize a new 'lobby.rogen.json' configuration
		`);

		return ok(undefined);
	}
}
