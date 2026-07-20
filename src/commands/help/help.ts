import { Command } from "../command.js";
import { LogService } from "../../platform/log/log-service.js";
import { Result, ok } from "../../base/result.js";

export class HelpCommand implements Command {
	constructor(private readonly logService: LogService) {}

	execute(): Result<void, Error> {
		this.logService.info(`
Rogen - A tool for feature-based folder structures with Rojo

Usage:
  rogen [command] [options]

Commands:
  init                  Generate a .rogen.json config file
  watch                 Watch the source and generate automatically

Options:
  -c, --config <path>   Specify custom config file
  -t, --template <path> Specify path to the Rojo tree JSON template
  -e, --env <env>       Activate environments
  -m, --mode <mode>     Override modes (luau, ts, darklua, or custom)
  -s, --source <path>   Override the directory containing uncompiled code
  -b, --build <path>    Override output directory for transpiled code
  -o, --output <path>   Override path of Rojo project file
  -h, --help            Print help
  -v, --version         Print version
		`);

		return ok(undefined);
	}
}
