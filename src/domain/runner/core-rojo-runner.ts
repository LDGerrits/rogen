import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { LogLevel } from "../../platform/log/log-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { ToolLocator } from "../toolchain/tool-locator.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { RojoServer } from "./rojo-server.js";
import { StartedRojo } from "./started-rojo.js";
import { RojoProcess, RojoRunner, ServerExecutable } from "./rojo-runner.js";
import { ServerFinder } from "./server-finder.js";

export class CoreRojoRunner implements RojoRunner {
	declare readonly _serviceBrand: undefined;

	private readonly finder: ServerFinder;

	constructor(
		toolchainService: ToolchainService,
		private readonly processService: ProcessService,
		/** What Rogen was asked to print: Rojo logs as much as that. */
		private readonly logLevel: LogLevel = LogLevel.Info,
		locator?: ToolLocator
	) {
		this.finder = new ServerFinder(
			toolchainService,
			processService,
			locator
		);
	}

	find(
		directory: string,
		resource: string,
		signal?: AbortSignal
	): Promise<Result<ServerExecutable, DiagnosticsError>> {
		return this.finder.find(directory, resource, signal);
	}

	isRunning(pid: number): boolean {
		return this.processService.isRunning(pid);
	}

	terminateTree(pid: number): Promise<void> {
		return this.processService.terminateTree(pid);
	}

	start(
		executable: ServerExecutable,
		command: string,
		projectFile: string | undefined,
		flags: readonly string[],
		cwd: string,
		readsStdout = false
	): RojoProcess {
		return new StartedRojo(
			this.processService.spawn(
				executable.file,
				[
					command,
					...(projectFile === undefined ? [] : [projectFile]),
					...this.verbosity(),
					...flags,
				],
				{ cwd, env: RojoServer.logEnv(this.logLevel) }
			),
			!readsStdout && this.logLevel <= LogLevel.Error
		);
	}

	private verbosity(): string[] {
		if (this.logLevel >= LogLevel.Trace) return ["-vv"];
		return this.logLevel >= LogLevel.Debug ? ["-v"] : [];
	}
}
