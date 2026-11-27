import { FileSystemService } from "./file-system-service.js";

export class FileReplacer {
	constructor(private readonly fileSystemService: FileSystemService) {}

	async replace(
		file: string,
		staging: string,
		content: string
	): Promise<void> {
		try {
			await this.fileSystemService.writeFile(staging, content);
			await this.fileSystemService.rename(staging, file, true);
		} catch (error) {
			await this.fileSystemService.delete(staging).catch(() => undefined);
			throw error;
		}
	}
}
