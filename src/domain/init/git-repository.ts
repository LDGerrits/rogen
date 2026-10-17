import path from "path";
import { Result, err, ok } from "../../base/result.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { ProcessService } from "../../platform/process/process-service.js";

const TIMEOUT_MS = 30_000;

/** The git repository a new project starts, as `rojo init` starts one. */
export class GitRepository {
	constructor(
		private readonly processService: ProcessService,
		private readonly fileReader: FileReader
	) {}

	/** Whether `git init` would start a repository in `directory`: git is installed and no folder from `directory` up holds a `.git`, which marks a work tree. */
	async needsInit(directory: string): Promise<boolean> {
		if (!(await this.processService.which("git"))) return false;
		for (let folder = directory; ; folder = path.dirname(folder)) {
			if (await this.fileReader.exists(path.join(folder, ".git")))
				return false;
			if (path.dirname(folder) === folder) return true;
		}
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
