import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { StartedRojo } from "./started-rojo.js";
import { RojoProcess, RojoRunner, ServerExecutable } from "./rojo-runner.js";
import { ServerFinder } from "./server-finder.js";

export class CoreRojoRunner implements RojoRunner {
	declare readonly _serviceBrand: undefined;

	private readonly finder: ServerFinder;

	constructor(
		toolchainService: ToolchainService,
		private readonly processService: ProcessService
	) {
		this.finder = new ServerFinder(toolchainService, processService);
	}

	find(
		directory: string,
		resource: string,
		signal?: AbortSignal
	): Promise<Result<ServerExecutable, DiagnosticsError>> {
		return this.finder.find(directory, resource, signal);
	}

	start(
		executable: ServerExecutable,
		command: string,
		projectFile: string | undefined,
		flags: readonly string[],
		cwd: string
	): RojoProcess {
		return new StartedRojo(
			this.processService.spawn(
				executable.file,
				[
					command,
					...(projectFile === undefined ? [] : [projectFile]),
					...flags,
				],
				{ cwd, env: executable.server.env }
			),
			executable.server
		);
	}
}
