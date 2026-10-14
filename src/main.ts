import path from "path";
import { DisposableStore } from "./base/disposable.js";
import { UsageError, setUnexpectedErrorHandler } from "./base/errors.js";
import {
	CommandRegistry,
	CommandService,
	Extensions,
} from "./platform/commands/commands.js";
import { CommandFailure } from "./platform/commands/command-failure.js";
import { CoreCommandService } from "./platform/commands/core-command-service.js";
import {
	HELP_COMMAND,
	JsonOption,
	hasFlag,
	parseArgs,
} from "./platform/environment/args.js";
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
import { LogService } from "./platform/log/log-service.js";
import { PlainLogService } from "./platform/log/plain-log-service.js";
import { TerminalLogService } from "./platform/log/terminal-log-service.js";
import { ConsolePromptService } from "./platform/prompt/console-prompt-service.js";
import { PromptService } from "./platform/prompt/prompt-service.js";
import { CoreProductService } from "./platform/product/core-product-service.js";
import { ProductService } from "./platform/product/product-service.js";
import { NativeProcessService } from "./platform/process/native-process-service.js";
import { ProcessService } from "./platform/process/process-service.js";
import { NativeRequestService } from "./platform/request/native-request-service.js";
import { RequestService } from "./platform/request/request-service.js";
import { CoreReleaseService } from "./platform/release/core-release-service.js";
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
import { CoreUpdateService } from "./domain/update/core-update-service.js";
import { CoreWatchService } from "./domain/watch/core-watch-service.js";
import { WatchService } from "./domain/watch/watch-service.js";
import { CoreConfigService } from "./domain/config/core-config-service.js";
import { CoreRojoRunner } from "./domain/runner/core-rojo-runner.js";
import { RojoRunner } from "./domain/runner/rojo-runner.js";
import { CoreServeService } from "./domain/serve/core-serve-service.js";
import { ServeService } from "./domain/serve/serve-service.js";
import "./commands/build/build-command.js";
import "./commands/check/check-command.js";
import "./commands/help/help-command.js";
import "./commands/init/init-command.js";
import "./commands/list/list-command.js";
import "./commands/serve/serve-command.js";
import "./commands/watch/watch-command.js";
import "./commands/where/where-command.js";

/** The version `scripts/bundle.ts` bakes into a bundle; undefined in a run from source. */
declare const ROGEN_VERSION: string | undefined;

/** The folder rogen runs in, or `undefined` when it was deleted under the shell. */
function currentFolder(): string | undefined {
	try {
		return process.cwd();
	} catch {
		return undefined;
	}
}

function printNotice(logService: LogService, notice: string | undefined): void {
	if (notice) logService.notice(notice);
}

export default function run(): void {
	new RogenMain().main().catch((error) => {
		console.error("Fatal Error:", error);
		process.exitCode = 1;
	});
}

/** The composition root: reads the command line, builds the services in dependency order and runs the command. */
class RogenMain {
	private readonly disposables = new DisposableStore();

	async main(): Promise<void> {
		try {
			await this.startup();
		} finally {
			this.disposables[Symbol.dispose]();
		}
	}

	private async startup(): Promise<void> {
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
		const json = hasFlag(rawArgs, JsonOption);
		const options = argsResult.isOk() ? argsResult.value.line.options : {};
		const cwd = currentFolder();
		const environmentService = new NativeEnvironmentService(
			{ ...options, json },
			cwd ?? path.parse(process.execPath).root
		);
		const logService = this.createLogService(environmentService);
		const failure = new CommandFailure(logService, json);

		if (argsResult.isErr()) {
			process.exitCode = failure.finish(argsResult.error);
			return;
		}
		const { command, line } = argsResult.value;
		if (cwd === undefined && command !== HELP_COMMAND) {
			process.exitCode = failure.finish(
				new UsageError(
					"The current folder no longer exists. cd to one that does, then run rogen again."
				),
				command
			);
			return;
		}

		// Default handler throws async, which would crash `watch`.
		setUnexpectedErrorHandler((error) => logService.error(error));

		const { services, updateService } = this.createServices(
			environmentService,
			logService
		);
		const commandService = new CoreCommandService(
			services,
			logService,
			commandRegistry
		);
		services.set(CommandService, commandService);

		// Started before the command so the check runs beside it. It never fails a run, and `--version` and `help` don't ask.
		const notice =
			command === HELP_COMMAND
				? undefined
				: updateService.check().catch(() => undefined);
		// A command that never ends can't tell the user afterwards.
		const noticeFirst =
			commandRegistry.getCommand(command)?.metadata.longRunning;
		if (noticeFirst) printNotice(logService, await notice);

		const result = await commandService
			.executeCommand(command, line)
			.catch((error: unknown) => {
				failure.reportCrash(error);
				throw error;
			});

		process.exitCode = result.isErr()
			? failure.finish(result.error, command)
			: 0;
		if (!noticeFirst) printNotice(logService, await notice);
	}

	private createLogService(
		environmentService: EnvironmentService
	): LogService {
		const logService: LogService = environmentService.isPlain
			? new PlainLogService(
					environmentService.cwd,
					environmentService.annotationsIn
				)
			: new TerminalLogService(
					environmentService.cwd,
					environmentService.annotationsIn
				);
		logService.setLevel(environmentService.logLevel);
		return logService;
	}

	/** Constructs every service in dependency order and registers each under its identifier. */
	private createServices(
		environmentService: EnvironmentService,
		logService: LogService
	): { services: ServiceCollection; updateService: CoreUpdateService } {
		const { disposables } = this;
		const services = new ServiceCollection();
		services.set(EnvironmentService, environmentService);
		services.set(LogService, logService);
		const promptService = new ConsolePromptService({
			interactive: environmentService.isInteractive,
			color: !environmentService.isPlain,
		});
		services.set(PromptService, promptService);

		const fileSystemService = new DiskFileSystemService();
		services.set(FileSystemService, fileSystemService);
		const indexService = new CoreIndexService(fileSystemService);
		services.set(IndexService, indexService);
		const requestService = new NativeRequestService();
		services.set(RequestService, requestService);
		const processService = new NativeProcessService();
		services.set(ProcessService, processService);
		services.set(
			LifecycleService,
			disposables.add(new NativeLifecycleService())
		);
		const watcher = disposables.add(new DiskWatcher(logService));
		services.set(Watcher, watcher);
		const productService = new CoreProductService(
			fileSystemService,
			import.meta.dirname,
			typeof ROGEN_VERSION === "string" ? ROGEN_VERSION : undefined
		);
		services.set(ProductService, productService);

		const configService = new CoreConfigService(
			fileSystemService,
			environmentService
		);
		services.set(ConfigService, configService);
		disposables.add(configService.registerFileCheck(LegacyConfig.check));
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
				environmentService,
				toolchainService,
				configService
			)
		);
		const watchService = new CoreWatchService(
			watcher,
			indexService,
			buildService
		);
		services.set(WatchService, watchService);
		const rojoRunner = new CoreRojoRunner(toolchainService, processService);
		services.set(RojoRunner, rojoRunner);
		services.set(
			ServeService,
			new CoreServeService(
				configService,
				fileSystemService,
				rojoRunner,
				requestService,
				watchService,
				environmentService
			)
		);

		const updateService = new CoreUpdateService(
			new CoreReleaseService(
				fileSystemService,
				requestService,
				environmentService.cacheDir
			),
			productService,
			environmentService,
			toolchainService,
			fileSystemService,
			import.meta.dirname
		);
		return { services, updateService };
	}
}
