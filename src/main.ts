import { LocalFileSystem } from "./platform/fs/local-file-system.js";
import { runInitCommand } from "./commands/init.js";
import { parseArgs } from "./platform/cli/args.js";
import { runHelpCommand } from "./commands/help.js";
import { runVersionCommand } from "./commands/version.js";
import { ConsoleLogger, LogLevel } from "./platform/log/logger.js";
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

const fs = new LocalFileSystem();
const logger = new ConsoleLogger();

async function main(): Promise<void> {
	// Validate args
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

	// Resolve config
	const validator = new ConfigValidator()
		.addRule(new LegacyKeyRule())
		.addRule(new CustomModeRule())
		.addRule(new EnforceTypeRule())
		.addRule(new UnknownKeyRule());

	const normalizer = new ConfigNormalizer(fs);

	const configService = new ConfigService(normalizer, validator)
		.addProvider(new ToolchainProvider(fs))
		.addProvider(new FileConfigProvider(fs))
		.addProvider(new CliConfigProvider(cliArgs));

	const configResult = await configService.load({
		cwd,
		configPath: cliArgs.config,
	});

	if (configResult.isErr()) {
		logger.error(`Config Error: ${configResult.error.message}`);
		process.exit(1);
	}

	const config = configResult.unwrap();
	logger.debug(`Config successfully resolved: ${JSON.stringify(config)}`);

	// TODO implement other commands

	process.exit(0);
}

export default function run(): void {
	main().catch((error) => {
		logger.error(error);
		process.exit(1);
	});
}
