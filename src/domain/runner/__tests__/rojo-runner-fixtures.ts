import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { ProcessService } from "../../../platform/process/process-service.js";
import { CoreToolLocator } from "../../toolchain/core-tool-locator.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { CoreRojoRunner } from "../core-rojo-runner.js";

/** A runner over `fs` and `processes`, as Rogen wires it, printing at `logLevel`. */
export function rojoRunnerOf(
	fs: FileSystemService,
	processes: ProcessService,
	logLevel: LogLevel = LogLevel.Info
): CoreRojoRunner {
	const environment = new MockEnvironmentService("/repo", logLevel);
	return new CoreRojoRunner(
		new CoreToolchainService(fs),
		processes,
		new CoreToolLocator(processes, fs, environment),
		environment
	);
}
