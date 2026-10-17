import { createHash } from "crypto";
import path from "path";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

const digest = (text: string): string =>
	createHash("sha256").update(text).digest("hex");

/** What Rogen last wrote to each project file, as a hash kept beside the user's cache, since the file can't carry a mark: Rojo reads only the keys it knows. A file whose hash is not the last written one was edited since. */
export class WrittenRecords {
	private readonly remembered = new Map<string, string>();

	/** Without a `folder`, the records last for this process only. */
	constructor(
		private readonly fileSystemService?: FileSystemService,
		private readonly folder?: string
	) {}

	static hashOf(text: string): string {
		return digest(text);
	}

	/** The hash of what was last written to `file`, when something was. */
	async lastWritten(file: string): Promise<string | undefined> {
		const known = this.remembered.get(file);
		if (known !== undefined || !this.fileSystemService || !this.folder)
			return known;
		try {
			const stored = (
				await this.fileSystemService.readFile(this.recordOf(file))
			).trim();
			return stored === "" ? undefined : stored;
		} catch {
			return undefined;
		}
	}

	async remember(file: string, text: string): Promise<void> {
		const hash = digest(text);
		if ((await this.lastWritten(file)) === hash) return;
		this.remembered.set(file, hash);
		if (!this.fileSystemService || !this.folder) return;
		try {
			await this.fileSystemService.writeFile(this.recordOf(file), hash);
		} catch {
			// A cache that can't be written only loses the guard, never the build.
		}
	}

	private recordOf(file: string): string {
		return path.join(this.folder!, digest(path.resolve(file)).slice(0, 40));
	}
}
