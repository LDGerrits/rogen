import { ErrorUtils } from "../../base/errors.js";
import path from "path";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks, AgentInUse } from "./agent/agent-hooks.js";
import { HOOK_SCRIPT_FILE, CODING_AGENTS } from "./agent/coding-agent.js";
import { InitDirectory } from "./init-directory.js";

export class AgentReader {
	constructor(private readonly fileSystemService: FileReader) {}

	async fileIn(directory: InitDirectory): Promise<Result<AgentFile, Error>> {
		const texts = new Map<string, string | undefined>();
		for (const fileName of AgentFile.FILE_NAMES) {
			const text = await this.readIfThere(
				directory,
				fileName,
				directory.has(fileName)
			);
			if (text.isErr()) return text;
			texts.set(fileName, text.value);
		}
		return ok(AgentFile.choose((fileName) => texts.get(fileName)));
	}

	async hooksIn(
		directory: InitDirectory
	): Promise<Result<AgentHooks, Error>> {
		const inUse: AgentInUse[] = [];
		for (const target of CODING_AGENTS) {
			const signs = await Promise.all(
				target.signs.map((sign) =>
					this.fileSystemService.exists(
						path.join(directory.path, sign)
					)
				)
			);
			if (!signs.includes(true)) continue;
			const text = await this.readIfThere(directory, target.settingsFile);
			if (text.isErr()) return text;
			inUse.push({ agent: target, text: text.value });
		}
		return ok(
			new AgentHooks({
				scriptExists: await this.fileSystemService.exists(
					path.join(directory.path, HOOK_SCRIPT_FILE)
				),
				inUse,
			})
		);
	}

	/** `undefined` when absent; fails on an unreadable file rather than report it missing. */
	private async readIfThere(
		directory: InitDirectory,
		fileName: string,
		there?: boolean
	): Promise<Result<string | undefined, Error>> {
		const file = path.join(directory.path, fileName);
		if (!(there ?? (await this.fileSystemService.exists(file))))
			return ok(undefined);
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(file)
		);
		return text.isErr()
			? err(ErrorUtils.wrap(`Failed to read ${fileName}`, text.error))
			: text;
	}
}
