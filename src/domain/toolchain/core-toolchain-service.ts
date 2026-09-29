import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { detectWorkspace } from "./detect-workspace.js";
import {
	DetectedWorkspace,
	Language,
	LanguageRegistry,
	SyncTool,
	SyncToolRegistry,
} from "./toolchain.js";
import { ToolchainService } from "./toolchain-service.js";

export class CoreToolchainService implements ToolchainService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly languageRegistry: LanguageRegistry,
		private readonly syncToolRegistry: SyncToolRegistry
	) {}

	detect(directory: string): Promise<DetectedWorkspace> {
		return detectWorkspace(
			this.fileSystemService,
			this.languageRegistry.getLanguages(),
			directory
		);
	}

	getLanguage(id: string): Language {
		const language = this.languageRegistry.getLanguage(id);
		if (!language) throw new Error(`Language "${id}" is not registered.`);
		return language;
	}

	getLanguages(): readonly Language[] {
		return this.languageRegistry.getLanguages();
	}

	getSyncTools(): readonly SyncTool[] {
		return this.syncToolRegistry.getSyncTools();
	}
}
