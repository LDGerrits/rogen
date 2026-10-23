import { Result } from "../../base/result.js";
import { WriteService } from "../../domain/write/write-service.js";
import { CoreWriteService } from "../../domain/write/core-write-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { CoreConfigService } from "../../domain/config/core-config-service.js";
import { CoreInitService } from "../../domain/init/core-init-service.js";
import { InitService } from "../../domain/init/init-service.js";
import { CoreRojoCommandService } from "../../domain/runner/core-rojo-command-service.js";
import { CoreRojoRunner } from "../../domain/runner/core-rojo-runner.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";
import { RojoCompatibility } from "../../domain/runner/rojo-compatibility.js";
import { CoreToolchainService } from "../../domain/toolchain/core-toolchain-service.js";
import { ToolchainService } from "../../domain/toolchain/toolchain-service.js";
import { CoreCommandService } from "../../platform/commands/core-command-service.js";
import { CommandLine, parseArgs } from "../../platform/environment/args.js";
import { MockEnvironmentService } from "../../platform/environment/__tests__/mock-environment-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { CoreIndexService } from "../../platform/fs/core-index-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../platform/instantiation/service-collection.js";
import { LogService } from "../../platform/log/log-service.js";
import { MockLogService } from "../../platform/log/__tests__/mock-log-service.js";
import { InputService } from "../../platform/input/input-service.js";
import { MockInputService } from "../../platform/input/__tests__/mock-input-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { MockPromptService } from "../../platform/prompt/__tests__/mock-prompt-service.js";
import { CoreSyncbackService } from "../../domain/syncback/core-syncback-service.js";
import { SyncbackService } from "../../domain/syncback/syncback-service.js";
import { CoreServeService } from "../../domain/serve/core-serve-service.js";
import { ServeService } from "../../domain/serve/serve-service.js";
import { CoreWatchService } from "../../domain/watch/core-watch-service.js";
import { WatchService } from "../../domain/watch/watch-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { MockLifecycleService } from "../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { MockProcessService } from "../../platform/process/__tests__/mock-process-service.js";
import { BrowserService } from "../../platform/browser/browser-service.js";
import { MockBrowserService } from "../../platform/browser/__tests__/mock-browser-service.js";
import { RequestService } from "../../platform/request/request-service.js";
import { MockRequestService } from "../../platform/request/__tests__/mock-request-service.js";
import { MemoryWatcher } from "../../platform/watcher/memory-watcher.js";
import { ProductService } from "../../platform/product/product-service.js";
import { MockProductService } from "../../platform/product/__tests__/mock-product-service.js";
import {
	CommandRegistry,
	CommandService,
	Extensions,
} from "../../platform/commands/commands.js";
import { Registry } from "../../platform/registry/registry.js";
import { LegacyConfig } from "../../domain/legacy/legacy-config.js";
import { Watcher } from "../../platform/watcher/watcher.js";

export interface CommandHarnessOptions<L extends LogService> {
	readonly cwd?: string;
	readonly fs?: MemoryFileSystemService;
	readonly environment?: EnvironmentService;
	readonly log?: L;
	readonly prompt?: PromptService;
	readonly input?: InputService;
	readonly config?: ConfigService;
	readonly index?: IndexService;
	readonly lifecycle?: LifecycleService;
	readonly watcher?: Watcher;
	readonly processes?: ProcessService;
	readonly requests?: RequestService;
	readonly browser?: BrowserService;
	readonly product?: ProductService;
}

export interface CommandHarness<L extends LogService> {
	readonly fs: MemoryFileSystemService;
	readonly log: L;
	run(
		command: string,
		line?: Partial<CommandLine>
	): Promise<Result<void, Error>>;
}

/** Parses `argv` as `rogen` does, over the commands registered so far. */
export function parseCommandLine(...argv: string[]) {
	const registry = Registry.as<CommandRegistry>(Extensions.Commands);
	return parseArgs(argv, (command) => registry.getOptions(command), [
		...registry.getCommands().keys(),
	]);
}

export function commandHarness(
	options?: CommandHarnessOptions<MockLogService>
): CommandHarness<MockLogService>;
export function commandHarness<L extends LogService>(
	options: CommandHarnessOptions<L> & { readonly log: L }
): CommandHarness<L>;
export function commandHarness(
	options: CommandHarnessOptions<LogService> = {}
): CommandHarness<LogService> {
	const { cwd = "/repo" } = options;
	const fs = options.fs ?? new MemoryFileSystemService();
	const ready = options.fs ? undefined : fs.createDirectory(cwd);

	const log = options.log ?? new MockLogService();
	const environment = options.environment ?? new MockEnvironmentService(cwd);
	const prompt = options.prompt ?? new MockPromptService([], false);
	const config =
		options.config ?? legacyChecked(new CoreConfigService(fs, environment));
	const index = options.index ?? new CoreIndexService(fs);
	const toolchain = new CoreToolchainService(fs);
	const requests = options.requests ?? new MockRequestService();
	const build = new CoreWriteService(fs, index, toolchain.syncTools);
	const watcher = options.watcher ?? new MemoryWatcher(fs, log);
	const watch = new CoreWatchService(watcher, index, build);
	const processes = options.processes ?? new MockProcessService();

	const services = new ServiceCollection();
	services.set(EnvironmentService, environment);
	services.set(LogService, log);
	services.set(PromptService, prompt);
	services.set(InputService, options.input ?? new MockInputService());
	services.set(FileSystemService, fs);
	services.set(ConfigService, config);
	services.set(IndexService, index);
	services.set(ToolchainService, toolchain);
	services.set(WriteService, build);
	services.set(
		InitService,
		new CoreInitService(
			fs,
			prompt,
			environment,
			toolchain,
			processes,
			undefined,
			config
		)
	);
	services.set(
		LifecycleService,
		options.lifecycle ?? new MockLifecycleService()
	);
	services.set(Watcher, watcher);
	services.set(WatchService, watch);
	services.set(ProcessService, processes);
	services.set(RequestService, requests);
	services.set(BrowserService, options.browser ?? new MockBrowserService());
	services.set(ProductService, options.product ?? new MockProductService());
	const rojoRunner = new CoreRojoRunner(toolchain, processes);
	const rojoCommands = new CoreRojoCommandService(
		rojoRunner,
		new RojoCompatibility(fs, false)
	);
	services.set(RojoCommandService, rojoCommands);
	services.set(
		SyncbackService,
		new CoreSyncbackService(fs, build, rojoCommands)
	);
	services.set(
		ServeService,
		new CoreServeService(
			config,
			fs,
			rojoRunner,
			requests,
			watch,
			environment
		)
	);

	const commands = new CoreCommandService(
		services,
		log,
		Registry.as<CommandRegistry>(Extensions.Commands)
	);
	services.set(CommandService, commands);
	return {
		fs,
		log,
		run: (command, line = {}) => {
			const execute = () =>
				commands.executeCommand(command, {
					positionals: [],
					options: {},
					...line,
				});
			return ready ? ready.then(execute) : execute();
		},
	};
}

function legacyChecked(config: CoreConfigService): CoreConfigService {
	config.registerFileCheck(LegacyConfig.check);
	config.registerFolderCheck(LegacyConfig.find);
	return config;
}
