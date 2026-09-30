import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { DarkluaDetector } from "./darklua.js";
import { Luau } from "./luau.js";
import { PackageManagerDetector } from "./package-managers.js";
import { RobloxTsCompiler, RobloxTsDetector } from "./roblox-ts.js";
import { Darklua, DetectedWorkspace, SyncTool } from "./toolchain.js";
import { ToolchainService } from "./toolchain-service.js";
import { WorkspaceDetector } from "./workspace-detector.js";

export class CoreToolchainService implements ToolchainService {
	declare readonly _serviceBrand: undefined;

	private readonly syncTools: readonly SyncTool[];
	private readonly detector: WorkspaceDetector;

	constructor(fileSystemService: FileSystemService) {
		const darklua = new Darklua();
		this.syncTools = [darklua, new RobloxTsCompiler()];
		this.detector = new WorkspaceDetector(
			fileSystemService,
			darklua,
			new DarkluaDetector(fileSystemService, darklua),
			new PackageManagerDetector(fileSystemService),
			[new Luau(), new RobloxTsDetector(fileSystemService)]
		);
	}

	detect(directory: string): Promise<DetectedWorkspace> {
		return this.detector.detect(directory);
	}

	getSyncTools(): readonly SyncTool[] {
		return this.syncTools;
	}
}
