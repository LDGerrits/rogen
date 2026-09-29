import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Luau } from "./luau.js";
import { RobloxTs, robloxTsSyncTool } from "./roblox-ts.js";
import {
	Darklua,
	DetectedWorkspace,
	Language,
	SyncTool,
} from "./toolchain.js";
import { ToolchainService } from "./toolchain-service.js";
import { WorkspaceDetector } from "./workspace-detector.js";

export class CoreToolchainService implements ToolchainService {
	declare readonly _serviceBrand: undefined;

	private readonly languages: readonly [Language, ...Language[]];
	private readonly syncTools: readonly SyncTool[] = [
		Darklua.syncTool,
		robloxTsSyncTool,
	];
	private readonly detector: WorkspaceDetector;

	constructor(fileSystemService: FileSystemService) {
		this.languages = [new Luau(), new RobloxTs(fileSystemService)];
		this.detector = new WorkspaceDetector(
			fileSystemService,
			this.languages
		);
	}

	detect(directory: string): Promise<DetectedWorkspace> {
		return this.detector.detect(directory);
	}

	getLanguage(id: string): Language {
		const language = this.languages.find((language) => language.id === id);
		if (!language) throw new Error(`Language "${id}" is not registered.`);
		return language;
	}

	getLanguages(): readonly Language[] {
		return this.languages;
	}

	getSyncTools(): readonly SyncTool[] {
		return this.syncTools;
	}
}
