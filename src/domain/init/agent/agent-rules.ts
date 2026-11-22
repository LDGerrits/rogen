import path from "path";
import { selfAndAncestors } from "../../../base/path.js";
import { tryWithAsync } from "../../../base/result.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { GitRepository } from "../git-repository.js";
import { agentBlock } from "./agent-block.js";
import { AgentFile } from "./agent-file.js";
import { HOOK_SCRIPT_FILE } from "./coding-agent.js";
import { hookScript } from "./hook-script.js";

const BLOCK = /<!-- rogen -->\r?\n[\s\S]*?<!-- \/rogen -->(\r?\n)?/;

function refreshedRules(text: string): string | undefined {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const current = agentBlock.replaceAll("\n", eol);
	const match = BLOCK.exec(text);
	if (!match || match[0] === current) return undefined;
	return `${text.slice(0, match.index)}${current}${text.slice(match.index + match[0].length)}`;
}

function refreshedScript(text: string): string | undefined {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const current = hookScript.replaceAll("\n", eol);
	const header = hookScript.slice(0, hookScript.indexOf("\n"));
	if (text === current || !text.startsWith(header)) return undefined;
	return current;
}

const REFRESHED = [
	...AgentFile.FILE_NAMES.map((fileName) => ({
		fileName,
		refresh: refreshedRules,
	})),
	{ fileName: HOOK_SCRIPT_FILE, refresh: refreshedScript },
];

export class AgentRules {
	constructor(
		private readonly git: GitRepository,
		@FileSystemService private readonly fileSystemService: FileSystemService
	) {}

	async refresh(folder: string): Promise<string[]> {
		const updated: string[] = [];
		for (const directory of await this.foldersUp(folder)) {
			for (const { fileName, refresh } of REFRESHED) {
				const file = path.join(directory, fileName);
				if (!(await this.fileSystemService.exists(file))) continue;
				const text = await tryWithAsync(() =>
					this.fileSystemService.readFile(file)
				);
				const refreshed = text.isOk() ? refresh(text.value) : undefined;
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
		const start = path.resolve(folder);
		const root = await this.git.workTreeOf(start);
		if (root === undefined) return [start];
		const folders: string[] = [];
		for (const current of selfAndAncestors(start)) {
			folders.push(current);
			if (current === root) break;
		}
		return folders;
	}
}
