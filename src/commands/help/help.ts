import { Command } from "../command.js";
import { LogService } from "../../platform/log/log-service.js";
import { Result, ok } from "../../base/result.js";

export class HelpCommand implements Command {
	constructor(private readonly logService: LogService) {}

	execute(): Result<void, Error> {
		this.logService.info(`
Rogen - Feature-based architecture for Roblox

Usage:
  rogen [command] [options]

Commands:
  init                 Generate a .rogen.json config file
  build                Build the project
  watch                Watch the source and build automatically

Options:
  -c, --config <path>  Specify custom config file
  -p, --project <path> Specify path to Rojo project
  -t, --tag <tag>      Activate environment tags
  -m, --mode <mode>    Override modes (luau, ts, darklua, or custom)
  -s, --source <path>  Override the directory containing uncompiled code
  -b, --build <path>   Override output directory for transpiled code
  -o, --output <path>  Override path of Rojo project file
  -h, --help           Print help
  -v, --version        Print version
		`);

		return ok(undefined);
	}
}
