import path from "path";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Darklua } from "./toolchain.js";

/** The Darklua config a workspace has. */
export class DarkluaDetector {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly darklua: Darklua
	) {}

	/** The first of Darklua's config files in `cwd`, or `undefined` when it has none. */
	async detect(cwd: string): Promise<string | undefined> {
		const found = await Promise.all(
			this.darklua.configFiles.map((file) =>
				this.fileSystemService.exists(path.join(cwd, file))
			)
		);
		return this.darklua.configFiles.find((_file, index) => found[index]);
	}
}
