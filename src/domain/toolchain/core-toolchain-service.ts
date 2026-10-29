import path from "path";
import { ancestors } from "../../base/path.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Luau } from "./luau.js";
import { TestRunnerDetector } from "./test-runner-detector.js";
import { RobloxTsCompiler, RobloxTsDetector } from "./roblox-ts.js";
import { Darklua, DetectedWorkspace, SyncTool } from "./toolchain.js";
import { ToolManifest } from "./tool-manifest.js";
import { ToolchainService } from "./toolchain-service.js";
import { WorkspaceDetector } from "./workspace-detector.js";

export class CoreToolchainService implements ToolchainService {
	declare readonly _serviceBrand: undefined;

	readonly syncTools: readonly SyncTool[] = [
		Darklua.SYNC_TOOL,
		RobloxTsCompiler.SYNC_TOOL,
	];
	private readonly detector: WorkspaceDetector;

	constructor(private readonly fileSystemService: FileSystemService) {
		this.detector = new WorkspaceDetector(
			fileSystemService,
			new TestRunnerDetector(fileSystemService),
			[new Luau(), new RobloxTsDetector(fileSystemService)]
		);
	}

	detect(directory: string): Promise<DetectedWorkspace> {
		return this.detector.detect(directory);
	}

	async readManifests(directory: string): Promise<readonly ToolManifest[]> {
		const manifests: ToolManifest[] = [];
		for (const dir of [directory, ...ancestors(directory)]) {
			for (const fileName of ToolManifest.FILE_NAMES) {
				const file = path.join(dir, fileName);
				if (!(await this.fileSystemService.exists(file))) continue;
				const manifest = await this.manifestAt(file);
				if (manifest) manifests.push(manifest);
			}
		}
		return manifests;
	}

	private async manifestAt(file: string): Promise<ToolManifest | undefined> {
		try {
			return ToolManifest.parse(
				file,
				await this.fileSystemService.readFile(file)
			);
		} catch {
			return undefined;
		}
	}
}
