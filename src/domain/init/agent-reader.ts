import { ErrorUtils } from "../../base/errors.js";
import path from "path";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { AgentFile } from "./agent-file.js";
import { AgentHooks, AgentInUse } from "./agent-hooks.js";
import { HOOK_SCRIPT_FILE, HOOK_TARGETS } from "./hook-target.js";
import { InitDirectory } from "./init-directory.js";

/** Reads what a directory holds for the coding agents it uses: their instruction files and their hooks. */
export class AgentReader {
	constructor(private readonly fileSystemService: FileSystemService) {}

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
		for (const target of HOOK_TARGETS) {
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
			inUse.push({ target, text: text.value });
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

	/** The text of `fileName`, or `undefined` when it isn't there. Fails on a file it can't read rather than take it for missing, which would write over it. */
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
