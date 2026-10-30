import path from "path";
import { tryWithAsync } from "../../../base/result.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { agentBlock } from "./agent-block.js";

const FILE_NAMES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"] as const;
const BLOCK = /<!-- rogen -->\r?\n[\s\S]*?<!-- \/rogen -->(\r?\n)?/;

/** `text` with its Rogen block replaced by this version's, in the file's line endings; `undefined` when it has none or it is current. */
function refreshedRules(text: string): string | undefined {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const current = agentBlock.replaceAll("\n", eol);
	const match = BLOCK.exec(text);
	if (!match || match[0] === current) return undefined;
	return `${text.slice(0, match.index)}${current}${text.slice(match.index + match[0].length)}`;
}

/** Keeps the Rogen block of a repository's agent files that of the Rogen that runs; a file without the block is never touched. */
export class AgentRules {
	constructor(private readonly fileSystemService: FileSystemService) {}

	/** Refreshes the agent files of `folder` and of each folder above it up to the repository root (only `folder` outside one), and returns the files it rewrote. A file it can't read or write is left as it is. */
	async refresh(folder: string): Promise<string[]> {
		const updated: string[] = [];
		for (const directory of await this.foldersUp(folder)) {
			for (const fileName of FILE_NAMES) {
				const file = path.join(directory, fileName);
				if (!(await this.fileSystemService.exists(file))) continue;
				const text = await tryWithAsync(() =>
					this.fileSystemService.readFile(file)
				);
				const refreshed = text.isOk()
					? refreshedRules(text.value)
					: undefined;
				if (refreshed === undefined) continue;
				const written = await tryWithAsync(() =>
					this.fileSystemService.writeFile(file, refreshed)
				);
				if (written.isOk()) updated.push(file);
			}
		}
		return updated;
	}

	private async foldersUp(folder: string): Promise<string[]> {
		const folders: string[] = [];
		for (let current = path.resolve(folder); ;) {
			folders.push(current);
			if (await this.fileSystemService.exists(path.join(current, ".git")))
				return folders;
			const parent = path.dirname(current);
			if (parent === current) return [path.resolve(folder)];
			current = parent;
		}
	}
}
