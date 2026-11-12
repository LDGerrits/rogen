import path from "path";
import { DisposableStore } from "./base/disposable.js";
import { IoError, setUnexpectedErrorHandler } from "./base/errors.js";
import {
	CommandRegistry,
	CommandService,
	Extensions,
} from "./platform/commands/commands.js";
import {
	CommandFailure,
	exitCode,
	exitCodeOf,
} from "./platform/commands/command-failure.js";
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
import { CoreInstantiationService } from "./platform/instantiation/core-instantiation-service.js";
import { ServicesAccessor } from "./platform/instantiation/instantiation.js";
import { ServiceCollection } from "./platform/instantiation/service-collection.js";
import { SyncDescriptor } from "./platform/instantiation/sync-descriptor.js";
import { LogService } from "./platform/log/log-service.js";
import { JsonLogService } from "./platform/log/json-log-service.js";
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
import { ReleaseService } from "./platform/release/release-service.js";
import { DiskWatcher } from "./platform/watcher/disk-watcher.js";
import { Watcher } from "./platform/watcher/watcher.js";
import { WriteService } from "./domain/write/write-service.js";
import { CoreWriteService } from "./domain/write/core-write-service.js";
import { ConfigService } from "./domain/config/config-service.js";
import { CoreInitService } from "./domain/init/core-init-service.js";
import { CoreToolLocator } from "./domain/toolchain/core-tool-locator.js";
import { ToolLocator } from "./domain/toolchain/tool-locator.js";
import { InitService } from "./domain/init/init-service.js";
import { LegacyConfig } from "./domain/legacy/legacy-config.js";
import { LegacyMigration } from "./domain/legacy/legacy-migration.js";
import { CoreToolchainService } from "./domain/toolchain/core-toolchain-service.js";
import { ToolchainService } from "./domain/toolchain/toolchain-service.js";
import { CoreUpdateService } from "./domain/update/core-update-service.js";
import { UpdateService } from "./domain/update/update-service.js";
import { CoreWatchService } from "./domain/watch/core-watch-service.js";
import { WatchService } from "./domain/watch/watch-service.js";
import { CoreConfigService } from "./domain/config/core-config-service.js";
import { CoreRojoRunner } from "./domain/runner/core-rojo-runner.js";
import { RojoRunner } from "./domain/runner/rojo-runner.js";
import { CoreRojoCommandService } from "./domain/runner/core-rojo-command-service.js";
import { RojoCommandService } from "./domain/runner/rojo-command-service.js";
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
import "./commands/plugin/plugin-command.js";
import "./commands/serve/serve-command.js";
import "./commands/sourcemap/sourcemap-command.js";
import "./commands/syncback/syncback-command.js";
import "./commands/upload/upload-command.js";
import "./commands/where/where-command.js";
import "./commands/write/write-command.js";

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
		check: Promise<string | undefined> | undefined,
		readonly printedFirst: boolean,
		@LogService private readonly logService: LogService
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
			parseArgs(args, (command) => commandRegistry.getOptions(command), [
				...commandRegistry.getCommands().keys(),
			]);
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
		const logService = this.createLogService(environmentService, json);
		const instantiationService = this.createInstantiationService(
			environmentService,
			logService,
			commandRegistry
		);
		this.disposables.add(instantiationService);
		const failure = instantiationService.createInstance(
			CommandFailure,
			json
		);

		if (argsResult.isErr()) {
			failure.report(argsResult.error);
			process.exitCode = exitCode(argsResult);
			return;
		}
		const { command, line } = argsResult.value;
		if (cwd === undefined && command !== HELP_COMMAND) {
			const gone = new IoError(
				"The current folder no longer exists.",
				"cd to one that does, then run rogen again."
			);
			failure.report(gone, command);
			process.exitCode = exitCodeOf(gone);
			return;
		}

		setUnexpectedErrorHandler((error) => logService.error(error));

		const { commandService, updateService, lifecycleService } =
			instantiationService.invokeFunction((accessor) => {
				this.contribute(accessor);
				return {
					commandService: accessor.get(CommandService),
					updateService: accessor.get(UpdateService),
					lifecycleService: accessor.get(LifecycleService),
				};
			});

		const notice = instantiationService.createInstance(
			UpdateNotice,
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

		if (result.isErr()) failure.report(result.error, command);
		process.exitCode = exitCode(result, lifecycleService.signal);
		if (!notice.printedFirst) await notice.print();
	}

	private createLogService(
		environmentService: EnvironmentService,
		json: boolean
	): LogService {
		const logOptions = {
			cwd: environmentService.cwd,
			annotationsIn: environmentService.annotationsIn,
			color: environmentService.hasColor,
		};
		const logService: LogService = json
			? new JsonLogService()
			: environmentService.isPlain
				? new PlainLogService(logOptions)
				: new TerminalLogService(logOptions);
		logService.setLevel(environmentService.logLevel);
		return logService;
	}

	/** Registers each service with the class that implements it; a service is built when it is first asked for. */
	private createInstantiationService(
		environmentService: EnvironmentService,
		logService: LogService,
		commandRegistry: CommandRegistry
	): CoreInstantiationService {
		const services = new ServiceCollection();
		services.set(EnvironmentService, environmentService);
		services.set(LogService, logService);
		services.set(
			PromptService,
			new SyncDescriptor(ConsolePromptService, [
				{
					interactive: environmentService.isInteractive,
					color: environmentService.hasColor,
				},
			])
		);
		services.set(InputService, new SyncDescriptor(NativeInputService));
		services.set(
			FileSystemService,
			new SyncDescriptor(DiskFileSystemService)
		);
		services.set(IndexService, new SyncDescriptor(CoreIndexService));
		services.set(RequestService, new SyncDescriptor(NativeRequestService));
		services.set(ProcessService, new SyncDescriptor(NativeProcessService));
		services.set(BrowserService, new SyncDescriptor(CoreBrowserService));
		services.set(
			LifecycleService,
			new SyncDescriptor(NativeLifecycleService)
		);
		services.set(Watcher, new SyncDescriptor(DiskWatcher));
		services.set(
			ProductService,
			new SyncDescriptor(CoreProductService, [
				import.meta.dirname,
				typeof ROGEN_VERSION === "string" ? ROGEN_VERSION : undefined,
			])
		);
		services.set(ReleaseService, new SyncDescriptor(CoreReleaseService));
		services.set(ConfigService, new SyncDescriptor(CoreConfigService));
		services.set(
			ToolchainService,
			new SyncDescriptor(CoreToolchainService)
		);
		services.set(ToolLocator, new SyncDescriptor(CoreToolLocator));
		services.set(WriteService, new SyncDescriptor(CoreWriteService));
		services.set(InitService, new SyncDescriptor(CoreInitService));
		services.set(WatchService, new SyncDescriptor(CoreWatchService));
		services.set(RojoRunner, new SyncDescriptor(CoreRojoRunner));
		services.set(
			RojoCommandService,
			new SyncDescriptor(CoreRojoCommandService)
		);
		services.set(SyncbackService, new SyncDescriptor(CoreSyncbackService));
		services.set(ServeService, new SyncDescriptor(CoreServeService));
		services.set(
			UpdateService,
			new SyncDescriptor(CoreUpdateService, [import.meta.dirname])
		);
		services.set(
			CommandService,
			new SyncDescriptor(CoreCommandService, [commandRegistry])
		);
		return new CoreInstantiationService(services, true);
	}

	/** What other modules contribute to the services that ask for it. */
	private contribute(accessor: ServicesAccessor): void {
		const { disposables } = this;
		const configService = accessor.get(ConfigService);
		disposables.add(configService.registerFileCheck(LegacyConfig.check));
		disposables.add(configService.registerFolderCheck(LegacyConfig.find));
		disposables.add(
			accessor.get(InitService).registerMigration(new LegacyMigration())
		);
	}
}
