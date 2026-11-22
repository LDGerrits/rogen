import path from "path";
import { selfAndAncestors } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

const TIMEOUT_MS = 30_000;
const ENTRIES_PER_RUN = 100;

interface IndexEntry {
	readonly mode: string;
	readonly sha: string;
	readonly stage: string;
	readonly file: string;
}

function indexEntriesOf(listing: string): IndexEntry[] {
	return listing
		.split("\0")
		.filter((line) => line !== "")
		.map((line) => {
			const tab = line.indexOf("\t");
			const [mode, sha, stage] = line.slice(0, tab).split(" ");
			return { mode, sha, stage, file: line.slice(tab + 1) };
		});
}

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

	// Git on a case-blind disk takes a folder renamed only in case for the
	// same folder and keeps the old name, so the index entries move by hand.
	async moveTracked(
		directory: string,
		from: string,
		to: string
	): Promise<void> {
		const git = await this.processService.which("git");
		if (!git) return;
		const run = (args: string[]) =>
			this.processService.exec(git, args, {
				cwd: directory,
				timeout: TIMEOUT_MS,
			});
		const listed = await run(["ls-files", "-s", "-z", "--", from]);
		if (listed.isErr() || listed.value.code !== 0) return;
		const entries = indexEntriesOf(listed.value.stdout).filter(
			({ stage }) => stage === "0"
		);
		for (let start = 0; start < entries.length; start += ENTRIES_PER_RUN) {
			const batch = entries.slice(start, start + ENTRIES_PER_RUN);
			await run([
				"update-index",
				"--force-remove",
				"--",
				...batch.map(({ file }) => file),
			]);
			await run([
				"update-index",
				"--add",
				...batch.flatMap(({ mode, sha, file }) => [
					"--cacheinfo",
					`${mode},${sha},${to}${file.slice(from.length)}`,
				]),
			]);
		}
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
