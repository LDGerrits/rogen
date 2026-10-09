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

export interface CommandHarnessOptions {
	/** The working directory; created in `fs`. */
	readonly cwd?: string;
	readonly fs?: MemoryFileSystemService;
	readonly environment?: EnvironmentService;
	readonly log?: MockLogService;
	readonly prompt?: PromptService;
	/** Replaces the real config service, for a test that scripts what configs resolve to. */
	readonly config?: ConfigService;
	readonly index?: IndexService;
}

export interface CommandHarness {
	readonly fs: MemoryFileSystemService;
	readonly log: MockLogService;
	readonly config: ConfigService;
	/** Runs `command` the way `rogen <command>` does, over the harness's services. */
	run(
		command: string,
		line?: Partial<CommandLine>
	): Promise<Result<void, Error>>;
}

/** The services `main.ts` wires, over an in-memory file system; tests change one service by naming it. */
export async function commandHarness(
	options: CommandHarnessOptions = {}
): Promise<CommandHarness> {
	const { cwd = "/repo" } = options;
	const fs = options.fs ?? new MemoryFileSystemService();
	await fs.createDirectory(cwd);

	const log = options.log ?? new MockLogService();
	const environment = options.environment ?? new MockEnvironmentService(cwd);
	const prompt = options.prompt ?? new MockPromptService([], false);
	const config = options.config ?? new CoreConfigService(fs, environment);
	const index = options.index ?? new CoreIndexService(fs);
	const toolchain = new CoreToolchainService(fs);

	const services = new ServiceCollection();
	services.set(EnvironmentService, environment);
	services.set(LogService, log);
	services.set(PromptService, prompt);
	services.set(FileSystemService, fs);
	services.set(ConfigService, config);
	services.set(IndexService, index);
	services.set(ToolchainService, toolchain);
	services.set(
		BuildService,
		new CoreBuildService(fs, index, toolchain.syncTools)
	);
	services.set(
		InitService,
		new CoreInitService(fs, prompt, environment, toolchain, config)
	);

	const commands = new CoreCommandService(services, log);
	return {
		fs,
		log,
		config,
		run: (command, line = {}) =>
			commands.executeCommand(command, {
				positionals: [],
				options: {},
				...line,
			}),
	};
}
