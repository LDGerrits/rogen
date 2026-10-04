import { DisposableStore } from "./base/disposable.js";
import { setUnexpectedErrorHandler } from "./base/errors.js";
import {
	CommandRegistry,
	CommandService,
	Extensions,
} from "./platform/commands/commands.js";
import { CommandFailure } from "./platform/commands/command-failure.js";
import { CoreCommandService } from "./platform/commands/core-command-service.js";
import { hasFlag, parseArgs } from "./platform/environment/args.js";
import { EnvironmentService } from "./platform/environment/environment-service.js";
import { NativeEnvironmentService } from "./platform/environment/native-environment-service.js";
import { DiskFileSystemService } from "./platform/fs/disk-file-system-service.js";
import { FileSystemService } from "./platform/fs/file-system-service.js";
import { CoreIndexService } from "./platform/fs/core-index-service.js";
import { IndexService } from "./platform/fs/index-service.js";
import { LifecycleService } from "./platform/lifecycle/lifecycle-service.js";
import { NativeLifecycleService } from "./platform/lifecycle/native-lifecycle-service.js";
import { Registry } from "./platform/registry/registry.js";
import { ServiceCollection } from "./platform/instantiation/service-collection.js";
import { LogLevel, LogService } from "./platform/log/log-service.js";
import { PlainLogService } from "./platform/log/plain-log-service.js";
import { TerminalLogService } from "./platform/log/terminal-log-service.js";
import { ConsolePromptService } from "./platform/prompt/console-prompt-service.js";
import { PromptService } from "./platform/prompt/prompt-service.js";
import { CoreProductService } from "./platform/product/core-product-service.js";
import { ProductService } from "./platform/product/product-service.js";
import { DiskWatcher } from "./platform/watcher/disk-watcher.js";
import { Watcher } from "./platform/watcher/watcher.js";
import { BuildService } from "./domain/build/build-service.js";
import { CoreBuildService } from "./domain/build/core-build-service.js";
import { ConfigService } from "./domain/config/config-service.js";
import { CoreInitService } from "./domain/init/core-init-service.js";
import { InitService } from "./domain/init/init-service.js";
import { LegacyConfig } from "./domain/legacy/legacy-config.js";
import { CoreToolchainService } from "./domain/toolchain/core-toolchain-service.js";
import { ToolchainService } from "./domain/toolchain/toolchain-service.js";
import { CoreWatchService } from "./domain/watch/core-watch-service.js";
import { WatchService } from "./domain/watch/watch-service.js";
import { CoreConfigService } from "./domain/config/core-config-service.js";
import "./commands/build/build-command.js";
import "./commands/help/help-command.js";
import "./commands/init/init-command.js";
import "./commands/list/list-command.js";
import "./commands/version/version-command.js";
import "./commands/watch/watch-command.js";
import "./commands/where/where-command.js";

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
		const argsResult = parseArgs(
			rawArgs,
			(command) => commandRegistry.getOptions(command),
			[...commandRegistry.getCommands().keys()]
		);

		// Read from the raw line, so a parse error is reported the way the flags ask.
		// A JSON document is read by a program, which can't answer a prompt.
		const json = hasFlag(rawArgs, "--json");
		const promptService = new ConsolePromptService({
			noInput: json || hasFlag(rawArgs, "--no-input"),
		});
		const logService: LogService = promptService.isInteractive
			? new TerminalLogService(process.cwd())
			: new PlainLogService(process.cwd());
		const failure = new CommandFailure(logService, json);

		if (argsResult.isErr()) {
			failure.report(argsResult.error);
			process.exitCode = 1;
			return;
		}

		// Initialize environment
		const { command, options: cliArgs } = argsResult.unwrap();
		const environment = new NativeEnvironmentService(
			cliArgs,
			process.cwd()
		);

		// Logging levels
		if (environment.quiet) logService.setLevel(LogLevel.Error);
		else if (environment.verbose) logService.setLevel(LogLevel.Debug);

		// Default handler throws async, which would crash `watch`.
		setUnexpectedErrorHandler((error) => logService.error(error));

		const fileSystemService = new DiskFileSystemService();

		const services = new ServiceCollection();

		const configService = new CoreConfigService(
			fileSystemService,
			environment
		);
		services.set(ConfigService, configService);
		disposables.add(configService.registerFileCheck(LegacyConfig.check));

		services.set(EnvironmentService, environment);
		services.set(LogService, logService);
		services.set(PromptService, promptService);
		const indexService = new CoreIndexService(fileSystemService);
		services.set(FileSystemService, fileSystemService);
		services.set(IndexService, indexService);
		const toolchainService = new CoreToolchainService(fileSystemService);
		services.set(ToolchainService, toolchainService);
		const buildService = new CoreBuildService(
			fileSystemService,
			indexService,
			toolchainService.syncTools
		);
		services.set(BuildService, buildService);
		services.set(
			InitService,
			new CoreInitService(
				fileSystemService,
				promptService,
				environment,
				toolchainService,
				configService
			)
		);
		services.set(
			ProductService,
			new CoreProductService(fileSystemService, import.meta.dirname)
		);
		services.set(
			LifecycleService,
			disposables.add(new NativeLifecycleService())
		);
		const watcher = disposables.add(new DiskWatcher(logService));
		services.set(Watcher, watcher);
		services.set(
			WatchService,
			new CoreWatchService(watcher, indexService, buildService)
		);

		const commandService = new CoreCommandService(services, logService);
		services.set(CommandService, commandService);

		const result = await commandService.executeCommand(command, cliArgs);

		if (result.isErr()) {
			failure.report(result.error, command);
			process.exitCode = 1;
		} else {
			process.exitCode = 0;
		}
	} finally {
		disposables[Symbol.dispose]();
	}
}
