import path from "path";
import { firstLine } from "../../base/strings.js";
import { ErrorUtils, ToolError, failureReason } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { UndoLog } from "./undo-log.js";
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

	/** Stops at the first write that fails and undoes the writes before it; `onWritten` hears of each once the writes have all succeeded. A dry run writes nothing and calls it for what it would write. */
	async write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void,
		dryRun = false
	): Promise<Result<void, Error>> {
		const log = new UndoLog(this.fileSystemService, plan.directory);
		const written: InitWritten[] = [];
		const changed = await this.change(plan, log, written, dryRun);
		if (changed.isErr()) return err(await log.undo(changed.error));
		for (const item of written) onWritten(item);
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

	/** The scaffold, moves, files and folders, any of whose failure fails the run. */
	private async change(
		plan: InitPlan,
		log: UndoLog,
		written: InitWritten[],
		dryRun: boolean
	): Promise<Result<void, Error>> {
		if (plan.scaffold) {
			const scaffolded = await this.scaffold(
				plan.scaffold,
				plan.directory,
				log,
				dryRun
			);
			if (scaffolded.isErr()) return scaffolded;
			written.push({ kind: "scaffold", scaffold: plan.scaffold });
		}
		const at = (relative: string) => path.join(plan.directory, relative);
		for (const move of plan.moves) {
			const moved = dryRun
				? ok(undefined)
				: await attempt(
						`Failed to rename ${move.from} to ${move.to}`,
						() => log.rename(at(move.from), at(move.to))
					);
			if (moved.isErr()) return moved;
			written.push({ kind: "move", move });
		}
		for (const file of plan.files) {
			const wrote = dryRun
				? ok(undefined)
				: await attempt(`Failed to write ${file.fileName}`, () =>
						log.writeFile(at(file.fileName), file.content)
					);
			if (wrote.isErr()) return wrote;
			written.push({ kind: "file", file });
		}
		for (const directory of plan.directories) {
			const created = await attempt(
				`Failed to create ${directory}`,
				async () =>
					dryRun
						? !(await this.fileSystemService.exists(at(directory)))
						: log.createDirectory(at(directory))
			);
			if (created.isErr()) return created;
			if (created.value) written.push({ kind: "directory", directory });
		}
		return ok(undefined);
	}

	/** Runs the tool in the folder, making it first, then removes what it wrote that `init` replaces. */
	private async scaffold(
		{ command, replaces }: PlannedScaffold,
		directory: string,
		log: UndoLog,
		dryRun: boolean
	): Promise<Result<void, Error>> {
		if (dryRun) return ok(undefined);
		const created = await attempt(`Failed to create ${directory}`, () =>
			log.createDirectory(directory)
		);
		if (created.isErr()) return created;
		const failed = await log.recordAdded(directory, () =>
			this.failureOf(command, directory)
		);
		if (failed !== undefined)
			return err(
				new ToolError(
					`'${command.command}' failed: ${failed}.`,
					created.value
						? `Make ${directory}, run it there yourself, then run 'rogen init' again.`
						: `Run it in ${directory} yourself, then run 'rogen init' again.`
				)
			);
		return attempt("Failed to clear the starter", async () => {
			for (const file of replaces) {
				const target = path.join(directory, file);
				if (await this.fileSystemService.exists(target))
					await log.delete(target);
			}
		});
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
