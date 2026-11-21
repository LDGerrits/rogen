import path from "path";
import { tryWithAsync } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

export class ProjectFiles {
	constructor(
		private readonly directory: string,
		@FileSystemService private readonly fileSystemService: FileSystemService
	) {}

	async projectFilesHint(): Promise<string | undefined> {
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(
				path.join(this.directory, ".gitignore")
			)
		);
		if (text.isErr()) return undefined;
		const listed = text.value
			.split(/\r?\n/)
			.map((line) => line.trim())
			.includes("*.project.json");
		return listed
			? undefined
			: "Add *.project.json to .gitignore: Rogen writes those files, and they change with the tree. A clone runs 'rogen write' to make them.";
	}
}
