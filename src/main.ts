import { DisposableStore } from "./base/disposable.js";
import { setUnexpectedErrorHandler } from "./base/errors.js";
import {
	CommandRegistry,
	CommandService,
	Extensions,
} from "./platform/commands/commands.js";
import { CoreCommandService } from "./platform/commands/core-command-service.js";
import { ConfigService } from "./platform/config/config.js";
import { CoreConfigService } from "./platform/config/config-service.js";
import { parseArgs } from "./platform/environment/args.js";
import {
	EnvironmentService,
	NativeEnvironmentService,
} from "./platform/environment/environment-service.js";
import { DiskFileSystemService } from "./platform/fs/disk-file-system-service.js";
import { FileSystemService } from "./platform/fs/file-system-service.js";
import { LifecycleService } from "./platform/lifecycle/lifecycle-service.js";
import { NativeLifecycleService } from "./platform/lifecycle/native-lifecycle-service.js";
import { Registry } from "./platform/registry/registry.js";
import { ServiceCollection } from "./platform/instantiation/service-collection.js";
import {
	ConsoleLogService,
	LogLevel,
	LogService,
} from "./platform/log/log-service.js";
import { CoreReconciliationService } from "./platform/watcher/core-reconciliation-service.js";
import { DiskWatcher } from "./platform/watcher/disk-watcher.js";
import { ReconciliationService } from "./platform/watcher/reconciliation-service.js";
import { Watcher } from "./platform/watcher/watcher.js";
import "./domain/config/config.js";
import "./commands/build/build-command.js";
import "./commands/help/help-command.js";
import "./commands/init/init-command.js";
import "./commands/version/version-command.js";
import "./commands/watch/watch-command.js";

export default function run(): void {
	main().catch((error) => {
		console.error("Fatal Error:", error);
		process.exitCode = 1;
	});
}

async function main(): Promise<void> {
	const disposables = new DisposableStore();

	try {
		const commandRegistry = Registry.as<CommandRegistry>(
			Extensions.Commands
		);
		const rawArgs = process.argv.slice(2);
		const argsResult = parseArgs(rawArgs, (command) =>
			commandRegistry.getOptions(command)
		);

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

		// Default handler throws async, which would crash `watch`.
		setUnexpectedErrorHandler((error) => logService.error(error));

		const fileSystemService = new DiskFileSystemService();

		// Resolve config
		const configService = new CoreConfigService(
			fileSystemService,
			environment
		);

		try {
			await configService.initialize();
		} catch (error) {
			logService.error(
				error instanceof Error ? error.message : String(error)
			);
			process.exitCode = 1;
			return;
		}

		disposables.add(configService);

		const reconciliationService = disposables.add(
			new CoreReconciliationService(logService)
		);

		const services = new ServiceCollection();
		services.set(EnvironmentService, environment);
		services.set(LogService, logService);
		services.set(FileSystemService, fileSystemService);
		services.set(ConfigService, configService);
		services.set(
			LifecycleService,
			disposables.add(new NativeLifecycleService())
		);
		services.set(Watcher, new DiskWatcher(logService));
		services.set(ReconciliationService, reconciliationService);

		const commandService = disposables.add(
			new CoreCommandService(services, logService)
		);
		services.set(CommandService, commandService);

		const result = await commandService.executeCommand(command, cliArgs);

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
