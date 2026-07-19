import { LocalFileSystem } from "./platform/fs/file-system.js";
import { runInitCommand } from "./commands/init.js";
import { parseArgs } from "./platform/cli/args.js";
import { runHelpCommand } from "./commands/help.js";
import { runVersionCommand } from "./commands/version.js";
import { ConsoleLogger, LogLevel } from "./platform/log/logger.js";
import { getRawArgs, getCwd } from "./base/process.js";

const fs = new LocalFileSystem();
const logger = new ConsoleLogger();

async function main(): Promise<void> {
	const rawArgs = getRawArgs();
	const argsResult = parseArgs(rawArgs);

	if (argsResult.isErr()) {
		logger.error(argsResult.error.message);
		process.exit(1);
	}

	const cliArgs = argsResult.unwrap();

	// Set global logger level
	if (cliArgs.quiet) {
		logger.setLevel(LogLevel.Off);
	} else if (cliArgs.trace) {
		logger.setLevel(LogLevel.Trace);
	} else if (cliArgs.verbose) {
		logger.setLevel(LogLevel.Debug);
	}

	if (cliArgs.help) {
		runHelpCommand(logger);
		process.exit(0);
	}

	if (cliArgs.version) {
		runVersionCommand(logger);
		process.exit(0);
	}

	const cwd = getCwd();

	if (cliArgs.init) {
		const initResult = await runInitCommand(cwd, fs);

		if (initResult.isErr()) {
			logger.error(initResult.error.message);
			process.exit(1);
		}

		logger.info(
			"Successfully created .rogen.json in the current directory."
		);
		process.exit(0);
	}

	// TODO implement other commands

	process.exit(0);
}

export default function run(): void {
	main().catch((error) => {
		logger.error(error);
		process.exit(1);
	});
}
