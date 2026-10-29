import path from "path";
import { tryWithAsync } from "../../base/result.js";
import { FileReader } from "../../platform/fs/file-system-service.js";

/** What the files of a project folder say about its tooling. */
export class ProjectFiles {
	constructor(
		private readonly fileSystemService: FileReader,
		private readonly directory: string
	) {}

	/** What to tell the user to add to the `.gitignore` here so git leaves out the project files Rogen writes; none when there is no `.gitignore` (init writes one that does) or it lists them. */
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
