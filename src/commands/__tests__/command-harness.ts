import { Result } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { CoreBuildService } from "../../domain/build/core-build-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { CoreConfigService } from "../../domain/config/core-config-service.js";
import { CoreInitService } from "../../domain/init/core-init-service.js";
import { InitService } from "../../domain/init/init-service.js";
import { CoreToolchainService } from "../../domain/toolchain/core-toolchain-service.js";
import { ToolchainService } from "../../domain/toolchain/toolchain-service.js";
import { CoreCommandService } from "../../platform/commands/core-command-service.js";
import { CommandLine } from "../../platform/environment/args.js";
import { MockEnvironmentService } from "../../platform/environment/__tests__/mock-environment-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { CoreIndexService } from "../../platform/fs/core-index-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../platform/instantiation/service-collection.js";
import { LogService } from "../../platform/log/log-service.js";
import { MockLogService } from "../../platform/log/__tests__/mock-log-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { MockPromptService } from "../../platform/prompt/__tests__/mock-prompt-service.js";
import { CoreServeService } from "../../domain/serve/core-serve-service.js";
import { ServeService } from "../../domain/serve/serve-service.js";
import { CoreWatchService } from "../../domain/watch/core-watch-service.js";
import { WatchService } from "../../domain/watch/watch-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { MockLifecycleService } from "../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { MockProcessService } from "../../platform/process/__tests__/mock-process-service.js";
import { RequestService } from "../../platform/request/request-service.js";
import { MockRequestService } from "../../platform/request/__tests__/mock-request-service.js";
import { MemoryWatcher } from "../../platform/watcher/memory-watcher.js";
import { Watcher } from "../../platform/watcher/watcher.js";

export interface CommandHarnessOptions<L extends LogService> {
	readonly cwd?: string;
	/** The file system to run over, which must hold `cwd`; a new one with only `cwd` when absent. */
	readonly fs?: MemoryFileSystemService;
	readonly environment?: EnvironmentService;
	readonly log?: L;
	readonly prompt?: PromptService;
	/** In place of the real config service, for a test that scripts what the configs resolve to. */
	readonly config?: ConfigService;
	readonly index?: IndexService;
	readonly lifecycle?: LifecycleService;
	readonly watcher?: Watcher;
	readonly processes?: ProcessService;
	readonly requests?: RequestService;
}

export interface CommandHarness<L extends LogService> {
	readonly fs: MemoryFileSystemService;
	readonly log: L;
	/** Runs `command` the way `rogen <command>` does, over the harness's services. */
	run(
		command: string,
		line?: Partial<CommandLine>
	): Promise<Result<void, Error>>;
}

/** The services `main.ts` wires, over an in-memory file system; tests change one service by naming it. */
export function commandHarness<L extends LogService = MockLogService>(
	options: CommandHarnessOptions<L> = {}
): CommandHarness<L> {
	const { cwd = "/repo" } = options;
	const fs = options.fs ?? new MemoryFileSystemService();
	// A given file system starts the command at once, as main.ts does, for a test that acts while it starts.
	const ready = options.fs ? undefined : fs.createDirectory(cwd);

	const log = options.log ?? (new MockLogService() as LogService as L);
	const environment = options.environment ?? new MockEnvironmentService(cwd);
	const prompt = options.prompt ?? new MockPromptService([], false);
	const config = options.config ?? new CoreConfigService(fs, environment);
	const index = options.index ?? new CoreIndexService(fs);
	const toolchain = new CoreToolchainService(fs);
	const build = new CoreBuildService(fs, index, toolchain.syncTools);
	const watch = new CoreWatchService(
		options.watcher ?? new MemoryWatcher(fs, log),
		index,
		build
	);

	const services = new ServiceCollection();
	services.set(EnvironmentService, environment);
	services.set(LogService, log);
	services.set(PromptService, prompt);
	services.set(FileSystemService, fs);
	services.set(ConfigService, config);
	services.set(IndexService, index);
	services.set(ToolchainService, toolchain);
	services.set(BuildService, build);
	services.set(
		InitService,
		new CoreInitService(fs, prompt, environment, toolchain, config)
	);
	services.set(
		LifecycleService,
		options.lifecycle ?? new MockLifecycleService()
	);
	services.set(WatchService, watch);
	services.set(
		ServeService,
		new CoreServeService(
			config,
			fs,
			options.processes ?? new MockProcessService(),
			options.requests ?? new MockRequestService(),
			watch,
			environment
		)
	);

	const commands = new CoreCommandService(services, log);
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
