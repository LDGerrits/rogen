import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { DarkluaDetector } from "./darklua-detector.js";
import { Luau } from "./luau.js";
import { PackageManagerDetector } from "./package-manager-detector.js";
import { SyncTool } from "../build/build.js";
import { TestRunnerDetector } from "./test-runner-detector.js";
import { ROBLOX_TS_SYNC_TOOL, RobloxTsDetector } from "./roblox-ts.js";
import { Darklua, DetectedWorkspace } from "./toolchain.js";
import { ToolchainService } from "./toolchain-service.js";
import { WorkspaceDetector } from "./workspace-detector.js";

export class CoreToolchainService implements ToolchainService {
	declare readonly _serviceBrand: undefined;

	/** What each tool tells a build, which the composition root hands to the build service; the build never asks the toolchain. */
	readonly syncTools: readonly SyncTool[] = [
		Darklua.SYNC_TOOL,
		ROBLOX_TS_SYNC_TOOL,
	];
	private readonly detector: WorkspaceDetector;

	constructor(fileSystemService: FileSystemService) {
		const darklua = new Darklua();
		this.detector = new WorkspaceDetector(
			fileSystemService,
			darklua,
			new DarkluaDetector(fileSystemService, darklua),
			new PackageManagerDetector(fileSystemService),
			new TestRunnerDetector(fileSystemService),
			[new Luau(), new RobloxTsDetector(fileSystemService)]
		);
	}

	detect(directory: string): Promise<DetectedWorkspace> {
		return this.detector.detect(directory);
	}

	holdsCode(directory: string): Promise<boolean> {
		return this.detector.holdsCode(directory);
	}
}
