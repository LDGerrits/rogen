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
	ColorOption,
	HELP_COMMAND,
	JsonOption,
	choiceIn,
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
import { InputService } from "./platform/input/input-service.js";
import { NativeInputService } from "./platform/input/native-input-service.js";
import { ConsolePromptService } from "./platform/prompt/console-prompt-service.js";
import { PromptService } from "./platform/prompt/prompt-service.js";
import { CoreProductService } from "./platform/product/core-product-service.js";
import { ProductService } from "./platform/product/product-service.js";
import { NativeProcessService } from "./platform/process/native-process-service.js";
import { ProcessService } from "./platform/process/process-service.js";
import { NativeRequestService } from "./platform/request/native-request-service.js";
import { RequestService } from "./platform/request/request-service.js";
import { BrowserService } from "./platform/browser/browser-service.js";
import { CoreBrowserService } from "./platform/browser/core-browser-service.js";
import { CoreReleaseService } from "./platform/release/core-release-service.js";
import { DiskWatcher } from "./platform/watcher/disk-watcher.js";
import { Watcher } from "./platform/watcher/watcher.js";
import { BuildService } from "./domain/build/build-service.js";
import { CoreBuildService } from "./domain/build/core-build-service.js";
import { WrittenRecords } from "./domain/build/written-records.js";
import { ConfigService } from "./domain/config/config-service.js";
import { CoreInitService } from "./domain/init/core-init-service.js";
import { ToolLocator } from "./domain/toolchain/tool-locator.js";
import { InitService } from "./domain/init/init-service.js";
import { CommandPicker } from "./commands/picker/command-picker.js";
import { ProjectContext } from "./commands/picker/project-context.js";
import { LegacyConfig } from "./domain/legacy/legacy-config.js";
import { CoreToolchainService } from "./domain/toolchain/core-toolchain-service.js";
import { ToolchainService } from "./domain/toolchain/toolchain-service.js";
import { CoreUpdateService } from "./domain/update/core-update-service.js";
import { CoreWatchService } from "./domain/watch/core-watch-service.js";
import { WatchService } from "./domain/watch/watch-service.js";
import { CoreConfigService } from "./domain/config/core-config-service.js";
import { CoreRojoRunner } from "./domain/runner/core-rojo-runner.js";
import { RojoRunner } from "./domain/runner/rojo-runner.js";
import { CoreRojoCommandService } from "./domain/runner/core-rojo-command-service.js";
import { RojoCommandService } from "./domain/runner/rojo-command-service.js";
import { RojoCompatibility } from "./domain/runner/rojo-compatibility.js";
import { CoreServeService } from "./domain/serve/core-serve-service.js";
import { ServeService } from "./domain/serve/serve-service.js";
import { CoreSyncbackService } from "./domain/syncback/core-syncback-service.js";
import { SyncbackService } from "./domain/syncback/syncback-service.js";
import "./commands/build/build-command.js";
import "./commands/check/check-command.js";
import "./commands/fmt-project/fmt-project-command.js";
import "./commands/help/doc-command.js";
import "./commands/help/help-command.js";
import "./commands/init/init-command.js";
import "./commands/list/list-command.js";
import "./commands/plugin/plugin-command.js";
import "./commands/serve/serve-command.js";
import "./commands/sourcemap/sourcemap-command.js";
import "./commands/syncback/syncback-command.js";
import "./commands/upload/upload-command.js";
import "./commands/where/where-command.js";

/** Baked in by `scripts/bundle.ts`; undefined in a run from source. */
declare const ROGEN_VERSION: string | undefined;

/** The folder rogen runs in, or `undefined` when it was deleted under the shell. */
function currentFolder(): string | undefined {
	try {
		return process.cwd();
	} catch {
		return undefined;
	}
}

/** Whether the command runs until it is stopped, so the update notice comes before it starts. */
function isLongRunning(
	metadata: { longRunning?: boolean; longRunningWith?: string } | undefined,
	options: Readonly<Record<string, unknown>>
): boolean {
	return (
		metadata?.longRunning === true ||
		(metadata?.longRunningWith !== undefined &&
			options[metadata.longRunningWith] === true)
	);
}

/** The update notice of a run, looked up while the command runs. */
class UpdateNotice {
	private readonly found: Promise<string | undefined>;

	constructor(
		private readonly logService: LogService,
		check: Promise<string | undefined> | undefined,
		readonly printedFirst: boolean
	) {
		this.found =
			check?.catch(() => undefined) ?? Promise.resolve(undefined);
	}

	async print(): Promise<void> {
		const notice = await this.found;
		if (notice) this.logService.notice(notice);
	}
}

export default function run(): void {
	new RogenMain().main().catch((error) => {
		console.error("Fatal Error:", error);
		process.exitCode = 1;
	});
}

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
		const parse = (args: string[]) =>
			parseArgs(
				args,
				(command) => commandRegistry.getOptions(command),
				[...commandRegistry.getCommands().keys()],
				(command) => commandRegistry.getFormerOptions(command)
			);
		const argsResult = parse(rawArgs);

		const json = hasFlag(rawArgs, JsonOption);
		const options = argsResult.isOk()
			? argsResult.value.line.options
			: { color: choiceIn(rawArgs, ColorOption) };
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
		let { command, line, bare } = argsResult.value;
		if (cwd === undefined && command !== HELP_COMMAND) {
			process.exitCode = failure.finish(
				new UsageError(
					"The current folder no longer exists.",
					"cd to one that does, then run rogen again."
				),
				command
			);
			return;
		}

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

		if (bare && environmentService.isInteractive && !json) {
			const picked = await new CommandPicker(
				commandRegistry,
				services.get(PromptService),
				logService,
				new ProjectContext(
					services.get(ConfigService),
					services.get(FileSystemService),
					services.get(ProductService),
					environmentService.cwd
				)
			).pick();
			const parsed = picked.isOk() ? parse(picked.value) : picked;
			if (parsed.isErr()) {
				process.exitCode = failure.finish(parsed.error);
				return;
			}
			({ command, line, bare } = parsed.value);
		}

		const notice = new UpdateNotice(
			logService,
			command === HELP_COMMAND ? undefined : updateService.check(),
			isLongRunning(
				commandRegistry.getCommand(command)?.metadata,
				line.options
			)
		);
		if (notice.printedFirst) await notice.print();

		const result = await commandService
			.executeCommand(command, line)
			.catch((error: unknown) => {
				failure.reportCrash(error);
				throw error;
			});

		process.exitCode = result.isErr()
			? failure.finish(result.error, command)
			: bare
				? 2
				: 0;
		if (!notice.printedFirst) await notice.print();
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
		services.set(InputService, new NativeInputService());

		const fileSystemService = new DiskFileSystemService();
		services.set(FileSystemService, fileSystemService);
		const indexService = new CoreIndexService(fileSystemService);
		services.set(IndexService, indexService);
		const requestService = new NativeRequestService();
		services.set(RequestService, requestService);
		const processService = new NativeProcessService();
		services.set(ProcessService, processService);
		services.set(BrowserService, new CoreBrowserService(processService));
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
			toolchainService.syncTools,
			new WrittenRecords(
				fileSystemService,
				path.join(environmentService.cacheDir, "rogen", "written")
			)
		);
		services.set(BuildService, buildService);
		const toolLocator = new ToolLocator(
			processService,
			fileSystemService,
			environmentService.userHome
		);
		services.set(
			InitService,
			new CoreInitService(
				fileSystemService,
				promptService,
				environmentService,
				toolchainService,
				configService,
				processService,
				toolLocator
			)
		);
		const watchService = new CoreWatchService(
			watcher,
			indexService,
			buildService
		);
		services.set(WatchService, watchService);
		const rojoRunner = new CoreRojoRunner(
			toolchainService,
			processService,
			environmentService.logLevel,
			toolLocator
		);
		services.set(RojoRunner, rojoRunner);
		const rojoCommandService = new CoreRojoCommandService(
			rojoRunner,
			new RojoCompatibility(fileSystemService)
		);
		services.set(RojoCommandService, rojoCommandService);
		services.set(
			SyncbackService,
			new CoreSyncbackService(
				fileSystemService,
				buildService,
				rojoCommandService
			)
		);
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
