import { DiskFileSystemService } from "./platform/fs/disk-file-system-service.js";
import { InitCommand } from "./commands/init/init.js";
import { parseArgs } from "./commands/args.js";
import { LogLevel } from "./platform/log/log-service.js";
import { ToolchainProvider } from "./domain/config/providers/toolchain.js";
import { FileConfigProvider } from "./platform/config/providers/file.js";
import { CliConfigProvider } from "./domain/config/providers/cli.js";
import { ConsoleLogService } from "./platform/log/console-log-service.js";
import { ConfigResolver } from "./domain/config/resolver.js";
import { VersionCommand } from "./commands/version/version.js";
import { HelpCommand } from "./commands/help/help.js";
import { WorkspaceService } from "./domain/workspace/workspace-service.js";
import { ConfigService } from "./platform/config/config-service.js";
import { ConfigLoader } from "./domain/config/loader.js";
import path from "path";

const logService = new ConsoleLogService();
const fileSystemService = new DiskFileSystemService();

async function main(): Promise<void> {
	// Validate args
	const rawArgs = process.argv.slice(2);
	const argsResult = parseArgs(rawArgs);

	if (argsResult.isErr()) {
		logService.error(argsResult.error.message);
		process.exitCode = 1;
		return;
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
		const command = new HelpCommand(logService);
		command.execute();
		process.exitCode = 0;
		return;
	}

	if (cliArgs.version) {
		const command = new VersionCommand(logService);
		command.execute();
		process.exitCode = 0;
		return;
	}

	const cwd = process.cwd();
	const workspaceService = new WorkspaceService(cwd, fileSystemService);
	const configPath = cliArgs.config
		? path.resolve(cwd, cliArgs.config)
		: path.join(cwd, ".rogen.json");

	if (cliArgs.init) {
		const command = new InitCommand(
			cwd,
			fileSystemService,
			workspaceService
		);
		const result = await command.execute();

		if (result.isErr()) {
			logService.error(result.error.message);
			process.exitCode = 1;
			return;
		}

		logService.info(
			"Successfully created .rogen.json in the current directory."
		);
		process.exitCode = 0;
		return;
	}

	// Resolve config
	const configService = new ConfigService()
		.addProvider(new ToolchainProvider(workspaceService))
		.addProvider(
			new FileConfigProvider(
				fileSystemService,
				configPath,
				!cliArgs.config
			)
		)
		.addProvider(new CliConfigProvider(cwd, cliArgs));

	const resolver = new ConfigResolver(fileSystemService);
	const configLoader = new ConfigLoader(configService, resolver, cwd);
	const configResult = await configLoader.load();

	if (configResult.isErr()) {
		logService.error(`Config Error: ${configResult.error.message}`);
		process.exitCode = 1;
		return;
	}

	const config = configResult.unwrap();
	logService.debug(`Config successfully resolved: ${JSON.stringify(config)}`);

	// TODO implement other commands

	process.exitCode = 0;
}

export default function run(): void {
	main().catch((error) => {
		logService.error(error);
		process.exitCode = 1;
	});
}
