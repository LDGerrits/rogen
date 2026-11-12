import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { SyncDescriptor } from "../../../platform/instantiation/sync-descriptor.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { ProcessService } from "../../../platform/process/process-service.js";
import { CoreToolLocator } from "../../toolchain/core-tool-locator.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { ToolLocator } from "../../toolchain/tool-locator.js";
import { ToolchainService } from "../../toolchain/toolchain-service.js";
import { CoreRojoRunner } from "../core-rojo-runner.js";

/** A runner over `fs` and `processes`, as Rogen wires it, printing at `logLevel`. */
export function rojoRunnerOf(
	fs: FileSystemService,
	processes: ProcessService,
	logLevel: LogLevel = LogLevel.Info
): CoreRojoRunner {
	return instantiationOf(
		[FileSystemService, fs],
		[ProcessService, processes],
		[EnvironmentService, new MockEnvironmentService("/repo", logLevel)],
		[ToolchainService, new SyncDescriptor(CoreToolchainService)],
		[ToolLocator, new SyncDescriptor(CoreToolLocator)]
	).createInstance(CoreRojoRunner);
}
