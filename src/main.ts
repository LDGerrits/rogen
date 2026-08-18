import { DiskFileSystemService } from "./platform/fs/disk-file-system-service.js";
import { InitCommand } from "./commands/init/init-command.js";
import { LogLevel, ConsoleLogService } from "./platform/log/log-service.js";
import { VersionCommand } from "./commands/version/version-command.js";
import { HelpCommand } from "./commands/help/help-command.js";
import { WorkspaceService } from "./domain/workspace/workspace-service.js";
import { DisposableStore } from "./base/disposable.js";
import { BuildCommand } from "./commands/build/build-command.js";
import { CommandRegistry } from "./commands/command.js";
import { DiskWatcher } from "./platform/watcher/disk-watcher.js";
import { WatchCommand } from "./commands/watch/watch-command.js";
import { ReconciliationService } from "./platform/watcher/reconciliation-service.js";
import { parseArgs } from "./platform/environment/args.js";
import { NativeEnvironmentService } from "./platform/environment/environment-service.js";
import { RogenConfigService } from "./domain/config/config-service.js";

export default function run(): void {
	main().catch((error) => {
		console.error("Fatal Error:", error);
		process.exitCode = 1;
	});
}

async function main(): Promise<void> {
	const disposables = new DisposableStore();

	try {
		const rawArgs = process.argv.slice(2);
		const argsResult = parseArgs(rawArgs);

		if (argsResult.isErr()) {
			const tempLogger = new ConsoleLogService();
			tempLogger.error(argsResult.error.message);
			process.exitCode = 1;
			return;
		}

		// Initialize environment
		const { command, options: cliArgs } = argsResult.unwrap();
		const environment = new NativeEnvironmentService(
			cliArgs,
			process.cwd()
		);

		const logService = new ConsoleLogService();

		// Logging levels
		if (environment.quiet) logService.setLevel(LogLevel.Off);
		else if (environment.trace) logService.setLevel(LogLevel.Trace);
		else if (environment.verbose) logService.setLevel(LogLevel.Debug);

		const fileSystemService = new DiskFileSystemService();

		const workspaceService = new WorkspaceService(
			environment,
			fileSystemService
		);

		// Resolve Configuration Asynchronously
		const configResult = await RogenConfigService.create(
			fileSystemService,
			environment
		);

		if (configResult.isErr()) {
			logService.error(configResult.error.message);
			process.exitCode = 1;
			return;
		}

		const configService = configResult.unwrap();

		// Initialize commands
		const registry = new CommandRegistry();

		registry.register("help", () => new HelpCommand(logService));
		registry.register("version", () => new VersionCommand(logService));

		registry.register(
			"init",
			() =>
				new InitCommand(
					environment,
					fileSystemService,
					workspaceService,
					logService
				)
		);

		registry.register(
			"build",
			() => new BuildCommand(logService, configService)
		);

		registry.register(
			"watch",
			() =>
				new WatchCommand(
					logService,
					new DiskWatcher(logService),
					new ReconciliationService(logService),
					configService,
					environment
				)
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
