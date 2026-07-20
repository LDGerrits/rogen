import { LocalFileSystemService } from "./platform/fs/local-file-system-service.js";
import { InitCommand } from "./commands/init/init.js";
import { parseArgs } from "./platform/cli/args.js";
import { LogLevel } from "./platform/log/log-service.js";
import { getRawArgs, getCwd } from "./base/process.js";
import { ToolchainProvider } from "./platform/config/providers/toolchain.js";
import { FileConfigProvider } from "./platform/config/providers/file.js";
import { CliConfigProvider } from "./platform/config/providers/cli.js";
import { ConfigService } from "./platform/config/config-service.js";
import { ConsoleLogService } from "./platform/log/console-log-service.js";
import { ConfigResolver } from "./platform/config/resolver.js";
import { VersionCommand } from "./commands/version/version.js";
import { HelpCommand } from "./commands/help/help.js";
import { WorkspaceService } from "./platform/workspace/workspace-service.js";

const logService = new ConsoleLogService();
const fileSystemService = new LocalFileSystemService();

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

	const cwd = getCwd();

	const workspaceService = new WorkspaceService(cwd, fileSystemService);

	if (cliArgs.help) {
		const command = new HelpCommand(logService);
		command.execute();
		process.exit(0);
	}

	if (cliArgs.version) {
		const command = new VersionCommand(logService);
		command.execute();
		process.exit(0);
	}

	if (cliArgs.init) {
		const command = new InitCommand(
			cwd,
			fileSystemService,
			workspaceService
		);
		const result = await command.execute();

		if (result.isErr()) {
			logService.error(result.error.message);
			process.exit(1);
		}

		logService.info(
			"Successfully created .rogen.json in the current directory."
		);
		process.exit(0);
	}

	// Resolve config
	const resolver = new ConfigResolver(fileSystemService);

	const configService = new ConfigService(resolver)
		.addProvider(new ToolchainProvider(workspaceService))
		.addProvider(
			new FileConfigProvider(cwd, fileSystemService, cliArgs.config)
		)
		.addProvider(new CliConfigProvider(cwd, cliArgs));

	const configResult = await configService.resolve();

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
