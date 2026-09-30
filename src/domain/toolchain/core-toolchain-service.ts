import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Luau } from "./luau.js";
import { RobloxTsCompiler, RobloxTsDetector } from "./roblox-ts.js";
import { Darklua, DetectedWorkspace, SyncTool } from "./toolchain.js";
import { ToolchainService } from "./toolchain-service.js";
import { WorkspaceDetector } from "./workspace-detector.js";

export class CoreToolchainService implements ToolchainService {
	declare readonly _serviceBrand: undefined;

	private readonly syncTools: readonly SyncTool[] = [
		new Darklua(),
		new RobloxTsCompiler(),
	];
	private readonly detector: WorkspaceDetector;

	constructor(fileSystemService: FileSystemService) {
		this.detector = new WorkspaceDetector(fileSystemService, [
			new Luau(),
			new RobloxTsDetector(fileSystemService),
		]);
	}

	detect(directory: string): Promise<DetectedWorkspace> {
		return this.detector.detect(directory);
	}

	getSyncTools(): readonly SyncTool[] {
		return this.syncTools;
	}
}
