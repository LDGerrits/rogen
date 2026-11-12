import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LogLevel } from "../../platform/log/log-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { RojoServer } from "./rojo-server.js";
import { StartedRojo } from "./started-rojo.js";
import {
	RojoProcess,
	RojoRunner,
	ServerExecutable,
	SupervisedRojoOptions,
	SupervisedRojoProcess,
} from "./rojo-runner.js";
import { ServerFinder } from "./server-finder.js";
import { SupervisedRojo } from "./supervised-rojo.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";

export class CoreRojoRunner implements RojoRunner {
	declare readonly _serviceBrand: undefined;

	private readonly finder: ServerFinder;
	/** What Rogen was asked to print: Rojo logs as much as that. */
	private readonly logLevel: LogLevel;

	constructor(
		@ProcessService private readonly processService: ProcessService,
		@EnvironmentService environmentService: EnvironmentService,
		@InstantiationService instantiationService: InstantiationService
	) {
		this.logLevel = environmentService.logLevel;
		this.finder = instantiationService.createInstance(ServerFinder);
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
		keepStdoutWhenQuiet = false
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
			!keepStdoutWhenQuiet && this.logLevel <= LogLevel.Error
		);
	}

	supervise(
		start: () => RojoProcess,
		options?: SupervisedRojoOptions
	): SupervisedRojoProcess {
		return new SupervisedRojo(start, options);
	}

	private verbosity(): string[] {
		if (this.logLevel >= LogLevel.Trace) return ["-vv"];
		return this.logLevel >= LogLevel.Debug ? ["-v"] : [];
	}
}
