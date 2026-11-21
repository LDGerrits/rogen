import path from "path";
import { selfAndAncestors } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

const TIMEOUT_MS = 30_000;

export class GitRepository {
	constructor(
		@ProcessService private readonly processService: ProcessService,
		@FileSystemService private readonly fileReader: FileSystemService
	) {}

	async needsInit(directory: string): Promise<boolean> {
		if (!(await this.processService.which("git"))) return false;
		return (await this.workTreeOf(directory)) === undefined;
	}

	async tracks(directory: string, file: string): Promise<boolean> {
		const git = await this.processService.which("git");
		if (!git) return false;
		const listed = await this.processService.exec(
			git,
			["ls-files", "--error-unmatch", "--", file],
			{ cwd: directory, timeout: TIMEOUT_MS }
		);
		return listed.isOk() && listed.value.code === 0;
	}

	async workTreeOf(directory: string): Promise<string | undefined> {
		for (const folder of selfAndAncestors(directory))
			if (await this.fileReader.exists(path.join(folder, ".git")))
				return folder;
		return undefined;
	}

	async init(directory: string): Promise<Result<void, Error>> {
		const git = await this.processService.which("git");
		if (!git) return err(new Error("git is not installed."));
		const made = await this.processService.exec(git, ["init"], {
			cwd: directory,
			timeout: TIMEOUT_MS,
		});
		if (made.isErr()) return err(made.error);
		return made.value.code === 0
			? ok(undefined)
			: err(
					new Error(
						made.value.stderr.trim() ||
							`git init exited with code ${made.value.code}.`
					)
				);
	}
}
