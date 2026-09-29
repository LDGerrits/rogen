import { DisposableStore } from "./base/disposable.js";
import { CancelledError, setUnexpectedErrorHandler } from "./base/errors.js";
import {
	CommandRegistry,
	CommandService,
	Extensions,
} from "./platform/commands/commands.js";
import { CoreCommandService } from "./platform/commands/core-command-service.js";
import { parseArgs } from "./platform/environment/args.js";
import {
	EnvironmentService,
	NativeEnvironmentService,
} from "./platform/environment/environment-service.js";
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
import { DiagnosticsError } from "./platform/diagnostics/diagnostics-error.js";
import { ConsolePromptService } from "./platform/prompt/console-prompt-service.js";
import { PromptService } from "./platform/prompt/prompt-service.js";
import { CoreProductService } from "./platform/product/core-product-service.js";
import { ProductService } from "./platform/product/product-service.js";
import { CoreReconciliationService } from "./platform/watcher/core-reconciliation-service.js";
import { DiskWatcher } from "./platform/watcher/disk-watcher.js";
import { ReconciliationService } from "./platform/watcher/reconciliation-service.js";
import { Watcher } from "./platform/watcher/watcher.js";
import { BuildService } from "./domain/build/build-service.js";
import { CoreBuildService } from "./domain/build/core-build-service.js";
import { ConfigService } from "./domain/config/config-service.js";
import { CoreInitService } from "./domain/init/core-init-service.js";
import { InitService } from "./domain/init/init-service.js";
import { CoreToolchainService } from "./domain/toolchain/core-toolchain-service.js";
import { ToolchainService } from "./domain/toolchain/toolchain-service.js";
import { CoreOutputService } from "./domain/output/core-output-service.js";
import { OutputService } from "./domain/output/output-service.js";
import { configRefsForCommand } from "./commands/config-options.js";
import { CoreConfigService } from "./domain/config/core-config-service.js";
import "./domain/config/config.js";
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

function reportFailure(
	logService: LogService,
	error: Error,
	command: string
): void {
	if (error instanceof CancelledError) {
		logService.closeFrame(error.message);
		return;
	}
	if (error instanceof DiagnosticsError) {
		for (const diagnostic of error.diagnostics)
			logService.diagnostic(diagnostic);
	} else {
		logService.error(error.message);
	}
	logService.closeFrame(`${command} failed.`);
}

async function main(): Promise<void> {
	const disposables = new DisposableStore();

	try {
		const promptService = new ConsolePromptService();
		const logService: LogService = promptService.isInteractive
			? new TerminalLogService(process.cwd())
			: new PlainLogService(process.cwd());

		const commandRegistry = Registry.as<CommandRegistry>(
			Extensions.Commands
		);
		const rawArgs = process.argv.slice(2);
		const argsResult = parseArgs(rawArgs, (command) =>
			commandRegistry.getOptions(command)
		);

		if (argsResult.isErr()) {
			logService.error(argsResult.error.message);
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

		const configService = disposables.add(
			new CoreConfigService(fileSystemService, environment)
		);
		services.set(ConfigService, configService);

		const metadata = commandRegistry.getCommand(command)?.metadata;
		if (metadata?.requiresConfig) {
			const refs = configRefsForCommand(metadata, cliArgs);
			const initialized = refs.isOk()
				? await configService.initialize(refs.value)
				: refs;
			if (initialized.isErr()) {
				reportFailure(logService, initialized.error, command);
				process.exitCode = 1;
				return;
			}
		}

		const reconciliationService = disposables.add(
			new CoreReconciliationService(logService)
		);

		services.set(EnvironmentService, environment);
		services.set(LogService, logService);
		services.set(PromptService, promptService);
		const indexService = disposables.add(
			new CoreIndexService(fileSystemService)
		);
		services.set(FileSystemService, fileSystemService);
		services.set(IndexService, indexService);
		const toolchainService = new CoreToolchainService(fileSystemService);
		services.set(ToolchainService, toolchainService);
		services.set(
			BuildService,
			new CoreBuildService(
				fileSystemService,
				indexService,
				toolchainService
			)
		);
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
		services.set(OutputService, new CoreOutputService(fileSystemService));
		services.set(
			ProductService,
			new CoreProductService(fileSystemService, import.meta.dirname)
		);
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
			reportFailure(logService, result.error, command);
			process.exitCode = 1;
		} else {
			process.exitCode = 0;
		}
	} finally {
		disposables[Symbol.dispose]();
	}
}
