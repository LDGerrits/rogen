import path from "path";
import { DiskFileSystemService } from "./platform/fs/disk-file-system-service.js";
import { InitCommand } from "./commands/init/init-command.js";
import { parseArgs } from "./commands/args.js";
import { LogLevel, ConsoleLogService } from "./platform/log/log-service.js";
import { VersionCommand } from "./commands/version/version-command.js";
import { HelpCommand } from "./commands/help/help-command.js";
import { WorkspaceService } from "./domain/workspace/workspace-service.js";
import { DisposableStore } from "./base/disposable.js";
import { BuildCommand } from "./commands/build/build-command.js";
import { CommandRegistry } from "./commands/command.js";
import { ConfigReader } from "./platform/config/config-reader.js";
import { ConfigParser } from "./domain/config/config-parser.js";
import { DiskWatcher } from "./platform/watcher/disk-watcher.js";
import { WatchCommand } from "./commands/watch/watch-command.js";

export default function run(): void {
	main().catch((error) => {
		console.error("Fatal Error:", error);
		process.exitCode = 1;
	});
}

async function main(): Promise<void> {
	const disposables = new DisposableStore();
	const logService = new ConsoleLogService();

	try {
		const rawArgs = process.argv.slice(2);
		const argsResult = parseArgs(rawArgs);

		if (argsResult.isErr()) {
			logService.error(argsResult.error.message);
			process.exitCode = 1;
			return;
		}

		const { command, options: cliArgs } = argsResult.unwrap();

		// Logging levels
		if (cliArgs.quiet) logService.setLevel(LogLevel.Off);
		else if (cliArgs.trace) logService.setLevel(LogLevel.Trace);
		else if (cliArgs.verbose) logService.setLevel(LogLevel.Debug);

		const cwd = process.cwd();
		const fileSystemService = new DiskFileSystemService();
		const workspaceService = new WorkspaceService(cwd, fileSystemService);

		// Populate overrides
		const overrides: Record<string, unknown> = {};
		if (cliArgs.source) overrides.source = cliArgs.source;
		if (cliArgs.build || cliArgs.output || cliArgs.env) {
			const targetModes = cliArgs.mode || ["luau", "ts", "darklua"];
			for (const mode of targetModes) {
				overrides[mode] = {
					...(cliArgs.build && { build: cliArgs.build }),
					...(cliArgs.output && { output: cliArgs.output }),
					...(cliArgs.env && { env: cliArgs.env }),
				};
			}
		}

		// Config processing
		const configPath = cliArgs.config
			? path.resolve(cwd, cliArgs.config)
			: path.join(cwd, ".rogen.json");
		const configDir = path.dirname(configPath);

		const configReader = new ConfigReader(fileSystemService);
		const rawConfigResult = await configReader.read({
			configPath,
			isOptional: !cliArgs.config,
			overrides,
		});

		if (rawConfigResult.isErr()) {
			logService.error(rawConfigResult.error.message);
			process.exitCode = 1;
			return;
		}

		const configResult = await ConfigParser.parse(
			rawConfigResult.unwrap(),
			configDir,
			fileSystemService
		);

		if (configResult.isErr()) {
			logService.error(configResult.error.message);
			process.exitCode = 1;
			return;
		}

		const resolvedConfig = configResult.unwrap();

		// Initialize commands
		const registry = new CommandRegistry();
		registry.register("help", () => new HelpCommand(logService));
		registry.register("version", () => new VersionCommand(logService));
		registry.register(
			"init",
			() =>
				new InitCommand(
					cwd,
					fileSystemService,
					workspaceService,
					logService
				)
		);
		registry.register(
			"build",
			() => new BuildCommand(logService, resolvedConfig)
		);
		registry.register(
			"watch",
			() =>
				new WatchCommand(
					logService,
					new DiskWatcher(logService),
					fileSystemService,
					configPath,
					overrides,
					resolvedConfig
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
