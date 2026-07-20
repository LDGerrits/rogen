import { LocalFileSystemService } from "./platform/fs/local-file-system-service.js";
import { runInitCommand } from "./commands/init.js";
import { parseArgs } from "./platform/cli/args.js";
import { runHelpCommand } from "./commands/help.js";
import { runVersionCommand } from "./commands/version.js";
import { LogLevel } from "./platform/log/log-service.js";
import { getRawArgs, getCwd } from "./base/process.js";
import { ToolchainProvider } from "./platform/config/providers/toolchain.js";
import { FileConfigProvider } from "./platform/config/providers/file.js";
import { CliConfigProvider } from "./platform/config/providers/cli.js";
import { ConfigValidator } from "./platform/config/validator.js";
import { LegacyKeyRule } from "./platform/config/rules/legacy-key.js";
import { CustomModeRule } from "./platform/config/rules/custom-mode.js";
import { EnforceTypeRule } from "./platform/config/rules/enforce-type.js";
import { UnknownKeyRule } from "./platform/config/rules/unknown-key.js";
import { ConfigNormalizer } from "./platform/config/normalizer.js";
import { ConfigService } from "./platform/config/config-service.js";
import { ConsoleLogService } from "./platform/log/console-log-service.js";

const fileSystemService = new LocalFileSystemService();
const logService = new ConsoleLogService();

async function main(): Promise<void> {
	// Validate args
	const rawArgs = getRawArgs();
	const argsResult = parseArgs(rawArgs);

	if (argsResult.isErr()) {
		logService.error(argsResult.error.message);
		process.exit(1);
	}

	const cliArgs = argsResult.unwrap();

	// Set global logService level
	if (cliArgs.quiet) {
		logService.setLevel(LogLevel.Off);
	} else if (cliArgs.trace) {
		logService.setLevel(LogLevel.Trace);
	} else if (cliArgs.verbose) {
		logService.setLevel(LogLevel.Debug);
	}

	if (cliArgs.help) {
		runHelpCommand(logService);
		process.exit(0);
	}

	if (cliArgs.version) {
		runVersionCommand(logService);
		process.exit(0);
	}

	const cwd = getCwd();

	if (cliArgs.init) {
		const initResult = await runInitCommand(cwd, fileSystemService);

		if (initResult.isErr()) {
			logService.error(initResult.error.message);
			process.exit(1);
		}

		logService.info(
			"Successfully created .rogen.json in the current directory."
		);
		process.exit(0);
	}

	// Resolve config
	const validator = new ConfigValidator()
		.addRule(new LegacyKeyRule())
		.addRule(new CustomModeRule())
		.addRule(new EnforceTypeRule())
		.addRule(new UnknownKeyRule());

	const normalizer = new ConfigNormalizer(fileSystemService);

	const configService = new ConfigService(normalizer, validator)
		.addProvider(new ToolchainProvider(fileSystemService))
		.addProvider(new FileConfigProvider(fileSystemService))
		.addProvider(new CliConfigProvider(cliArgs));

	const configResult = await configService.load({
		cwd,
		configPath: cliArgs.config,
	});

	if (configResult.isErr()) {
		logService.error(`Config Error: ${configResult.error.message}`);
		process.exit(1);
	}

	const config = configResult.unwrap();
	logService.debug(`Config successfully resolved: ${JSON.stringify(config)}`);

	// TODO implement other commands

	process.exit(0);
}

export default function run(): void {
	main().catch((error) => {
		logService.error(error);
		process.exit(1);
	});
}
