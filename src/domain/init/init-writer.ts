import path from "path";
import { firstLine } from "../../base/strings.js";
import { selfAndAncestors } from "../../base/path.js";
import { ErrorUtils, ToolError, failureReason } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { GitRepository } from "./git-repository.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { ToolLocator } from "../toolchain/tool-locator.js";
import {
	InitPlan,
	InitWritten,
	PlannedCommand,
	PlannedScaffold,
} from "./init-service.js";

/** What `run` returns, or its failure wrapped with `what`. */
async function attempt<T>(
	what: string,
	run: () => Promise<T>
): Promise<Result<T, Error>> {
	const done = await tryWithAsync(run);
	return done.isErr() ? err(ErrorUtils.wrap(what, done.error)) : done;
}

export class InitWriter {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly git: GitRepository,
		private readonly processService: ProcessService,
		private readonly locator: ToolLocator
	) {}

	/** Stops at the first write that fails, calling `onWritten` after each. A dry run writes nothing and calls it for what it would write. */
	async write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void,
		dryRun = false
	): Promise<Result<void, Error>> {
		if (plan.scaffold) {
			const scaffolded = await this.scaffold(
				plan.scaffold,
				plan.directory,
				dryRun
			);
			if (scaffolded.isErr()) return scaffolded;
			onWritten({ kind: "scaffold", scaffold: plan.scaffold });
		}
		const at = (relative: string) => path.join(plan.directory, relative);
		for (const move of plan.moves) {
			const moved = dryRun
				? ok(undefined)
				: await attempt(
						`Failed to rename ${move.from} to ${move.to}`,
						() =>
							this.fileSystemService.rename(
								at(move.from),
								at(move.to)
							)
					);
			if (moved.isErr()) return moved;
			onWritten({ kind: "move", move });
		}
		for (const file of plan.files) {
			const written = dryRun
				? ok(undefined)
				: await attempt(`Failed to write ${file.fileName}`, () =>
						this.fileSystemService.writeFile(
							at(file.fileName),
							file.content
						)
					);
			if (written.isErr()) return written;
			onWritten({ kind: "file", file });
		}
		for (const directory of plan.directories) {
			const created = await attempt(
				`Failed to create ${directory}`,
				async () => {
					if (await this.fileSystemService.exists(at(directory)))
						return false;
					if (!dryRun)
						await this.fileSystemService.createDirectory(
							at(directory)
						);
					return true;
				}
			);
			if (created.isErr()) return created;
			if (created.value) onWritten({ kind: "directory", directory });
		}
		if (plan.gitInit) {
			const made = dryRun
				? ok(undefined)
				: await this.git.init(plan.directory);
			onWritten(
				made.isErr()
					? { kind: "git", failed: failureReason(made.error) }
					: { kind: "git" }
			);
		}
		await this.runCommands(plan, onWritten, dryRun);
		return ok(undefined);
	}

	/** Runs the tool in the folder, making it first, then removes what it wrote that `init` replaces; a failed run removes the folders it made, so a second `init` starts clean. */
	private async scaffold(
		{ command, replaces }: PlannedScaffold,
		directory: string,
		dryRun: boolean
	): Promise<Result<void, Error>> {
		if (dryRun) return ok(undefined);
		const outermostNew = await this.firstMissing(directory);
		if (outermostNew !== undefined) {
			const created = await attempt(`Failed to create ${directory}`, () =>
				this.fileSystemService.createDirectory(directory)
			);
			if (created.isErr()) return created;
		}
		const failed = await this.failureOf(command, directory);
		if (failed !== undefined) {
			if (outermostNew !== undefined)
				await tryWithAsync(() =>
					this.fileSystemService.delete(outermostNew, true)
				);
			return err(
				new ToolError(
					`'${command.command}' failed: ${failed}.`,
					outermostNew === undefined
						? `Run it in ${directory} yourself, then run 'rogen init' again.`
						: `Make ${directory}, run it there yourself, then run 'rogen init' again.`
				)
			);
		}
		return attempt("Failed to clear the starter", async () => {
			for (const file of replaces) {
				const target = path.join(directory, file);
				if (await this.fileSystemService.exists(target))
					await this.fileSystemService.delete(target, true);
			}
		});
	}

	/** The outermost folder of `directory` and its parents that isn't there, which making `directory` makes. */
	private async firstMissing(directory: string): Promise<string | undefined> {
		let missing: string | undefined;
		for (const folder of selfAndAncestors(directory)) {
			if (await this.fileSystemService.exists(folder)) break;
			missing = folder;
		}
		return missing;
	}

	/** A command that fails leaves the project written, so it is reported to the caller, which says what to run by hand, and the commands after it are skipped. */
	private async runCommands(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void,
		dryRun: boolean
	): Promise<void> {
		for (const [at, command] of plan.commands.entries()) {
			const failed = dryRun
				? undefined
				: await this.failureOf(command, plan.directory);
			if (failed === undefined) {
				onWritten({ kind: "command", command });
				continue;
			}
			onWritten({
				kind: "command",
				command,
				failed,
				skipped: plan.commands.slice(at + 1),
			});
			return;
		}
	}

	/** Why `command` did not finish, or `undefined` when it did. */
	private async failureOf(
		command: PlannedCommand,
		cwd: string
	): Promise<string | undefined> {
		const file = await this.locator.find(command.file);
		if (!file) return `${command.file} isn't installed`;
		const ran = await this.processService.exec(file, command.args, {
			cwd,
			timeout: command.timeout,
		});
		if (ran.isErr()) return failureReason(ran.error);
		if (ran.value.code === 0) return undefined;
		return (
			firstLine(ran.value.stderr) ??
			firstLine(ran.value.stdout) ??
			`exit code ${ran.value.code}`
		);
	}
}
