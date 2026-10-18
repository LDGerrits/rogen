import path from "path";
import { normalizeDir } from "../../base/path.js";
import { tryWithAsync } from "../../base/result.js";
import { FileReader } from "../../platform/fs/file-system-service.js";

/** What the files of a project folder say about its tooling. */
export class ProjectFiles {
	constructor(
		private readonly fileSystemService: FileReader,
		private readonly directory: string
	) {}

	/** Whether the editor settings here name luau-lsp. */
	async luauLspIsSetUp(): Promise<boolean> {
		for (const file of [
			".vscode/settings.json",
			".vscode/extensions.json",
		]) {
			const text = await tryWithAsync(() =>
				this.fileSystemService.readFile(path.join(this.directory, file))
			);
			if (
				text.isOk() &&
				/luau-lsp/i.test(text.value) &&
				!/luau-lsp\.sourcemap\.(enabled|autogenerate)"\s*:\s*false/.test(
					text.value
				)
			)
				return true;
		}
		return false;
	}

	/** What to tell the user to add to the `.gitignore` here when it doesn't list the sync path; none when there is no `.gitignore` (init writes one that does) or it lists it. */
	async gitignoreHint(syncPath: string): Promise<string | undefined> {
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(
				path.join(this.directory, ".gitignore")
			)
		);
		if (text.isErr()) return undefined;
		const folder = normalizeDir(syncPath).replace(/\/$/, "");
		const listed = text.value
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("#"))
			.map((line) =>
				line
					.replace(/^\*\*\//, "")
					.replace(/^\//, "")
					.replace(/\/(\*\*?)?$/, "")
			)
			.includes(folder);
		return listed
			? undefined
			: `Add /${folder} to .gitignore so the processed code isn't committed.`;
	}
}
