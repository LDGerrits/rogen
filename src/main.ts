import { DiskFileSystemService } from "./platform/fs/disk-file-system-service.js";
import { InitCommand } from "./commands/init/init.js";
import { parseArgs } from "./commands/args.js";
import { LogLevel } from "./platform/log/log-service.js";
import { ConsoleLogService } from "./platform/log/log-service.js";
import { VersionCommand } from "./commands/version/version.js";
import { HelpCommand } from "./commands/help/help.js";
import { WorkspaceService } from "./domain/workspace/workspace-service.js";
import { DisposableStore } from "./base/disposable.js";
import { ConfigLoader } from "./domain/config/config-loader.js";
import { ConfigResolver } from "./domain/config/config-resolver.js";
import { CliConfigProvider } from "./domain/config/providers/cli.js";
import { FileConfigProvider } from "./platform/config/providers/file.js";
import { ConfigService } from "./platform/config/config-service.js";
import path from "path";
import { BuildCommand } from "./commands/build/build.js";
import { CommandRegistry } from "./commands/command.js";

export default function run(): void {
	main().catch((error) => {
		console.error("Fatal Error:", error);
		process.exitCode = 1;
	});
}

async function main(): Promise<void> {
	const disposables = new DisposableStore();
	const logService = new ConsoleLogService();

	try {
		const rawArgs = process.argv.slice(2);
		const argsResult = parseArgs(rawArgs);

		if (argsResult.isErr()) {
			logService.error(argsResult.error.message);
			process.exitCode = 1;
			return;
		}

		const { command, options: cliArgs } = argsResult.unwrap();

		if (cliArgs.quiet) logService.setLevel(LogLevel.Off);
		else if (cliArgs.trace) logService.setLevel(LogLevel.Trace);
		else if (cliArgs.verbose) logService.setLevel(LogLevel.Debug);

		const cwd = process.cwd();
		const fileSystemService = new DiskFileSystemService();
		const workspaceService = new WorkspaceService(cwd, fileSystemService);

		// Process config
		const configPath = cliArgs.config
			? path.resolve(cwd, cliArgs.config)
			: path.join(cwd, ".rogen.json");
		const configDir = path.dirname(configPath);

		const configService = new ConfigService(logService)
			.addProvider(
				new FileConfigProvider(
					fileSystemService,
					configPath,
					!cliArgs.config
				)
			)
			.addProvider(new CliConfigProvider(cwd, cliArgs));

		const resolver = new ConfigResolver(fileSystemService);
		const configLoader = new ConfigLoader(
			configService,
			resolver,
			workspaceService,
			configDir
		);

		// Initialize commands
		const registry = new CommandRegistry();
		registry.register("help", () => new HelpCommand(logService));
		registry.register("version", () => new VersionCommand(logService));
		registry.register(
			"init",
			() =>
				new InitCommand(
					cwd,
					fileSystemService,
					workspaceService,
					logService
				)
		);
		// TODO
		registry.register(
			"build",
			() => new BuildCommand(logService, configLoader)
		);

		// Execute command
		const result = await registry.execute(command, cliArgs);

		if (result.isErr()) {
			logService.error(result.error.message);
			process.exitCode = 1;
		} else {
			process.exitCode = 0;
		}
	} finally {
		disposables[Symbol.dispose]();
	}
}
