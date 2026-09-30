import path from "path";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Darklua } from "./toolchain.js";

/** Whether a workspace has a Darklua config. */
export class DarkluaDetector {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly darklua: Darklua
	) {}

	async detect(cwd: string): Promise<boolean> {
		const found = await Promise.all(
			this.darklua.configFiles.map((file) =>
				this.fileSystemService.exists(path.join(cwd, file))
			)
		);
		return found.some(Boolean);
	}
}
