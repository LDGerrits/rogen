import path from "path";
import { NullDisposable } from "../../base/disposable.js";
import { firstLine } from "../../base/strings.js";
import {
	CancelledError,
	ErrorUtils,
	IoError,
	KindedError,
	ToolError,
	failureReason,
} from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { UndoLog } from "./undo-log.js";
import { DraftFileReader } from "../../platform/fs/draft-file-reader.js";
import {
	FileReader,
	FileSystemService,
} from "../../platform/fs/file-system-service.js";
import { GitRepository } from "./git-repository.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
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
): Promise<Result<T, IoError>> {
	const done = await tryWithAsync(run);
	return done.isErr()
		? err(ErrorUtils.wrap(what, done.error))
		: ok(done.value);
}

const stopped = () => new CancelledError("init stopped before it finished.");

/** `failure`, of its own kind, naming what undo left; a cancel that left nothing says the folder is as it was. */
function undone(failure: KindedError, left: readonly string[]): KindedError {
	if (left.length > 0)
		return failure.withReason(
			`${failure.reason.replace(/\.?$/, ".")} Could not put back ${left.join(", ")}.`
		);
	return failure instanceof CancelledError
		? failure.withReason(
				"init stopped before it finished, and put the folder back as it was."
			)
		: failure;
}

export class InitWriter {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly git: GitRepository,
		private readonly processService: ProcessService,
		private readonly locator: ToolLocator,
		private readonly lifecycleService: LifecycleService
	) {}

	/** Stops at the first write that fails, or at a shutdown, which also stops the scaffold, and undoes the writes before it; `onWritten` hears of each once the writes have all succeeded. A dry run writes nothing and calls it for what it would write, leaving a shutdown to end the process. */
	async write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void,
		dryRun = false
	): Promise<Result<void, Error>> {
		const log = new UndoLog(this.fileSystemService, plan.directory);
		const written: InitWritten[] = [];
		const stopping = new AbortController();
		const shutdown = dryRun
			? NullDisposable
			: this.lifecycleService.onWillShutdown(() => stopping.abort());
		try {
			const changed = await this.change(
				plan,
				log,
				written,
				dryRun,
				stopping.signal
			);
			const failure = stopping.signal.aborted
				? stopped()
				: changed.isErr()
					? changed.error
					: undefined;
			if (failure) return err(undone(failure, await log.undo()));
		} finally {
			shutdown[Symbol.dispose]();
		}
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
		dryRun: boolean,
		signal: AbortSignal
	): Promise<Result<void, KindedError>> {
		if (plan.scaffold) {
			const scaffolded = await this.scaffold(
				plan.scaffold,
				plan.directory,
				log,
				dryRun,
				signal
			);
			if (scaffolded.isErr()) return scaffolded;
			written.push({ kind: "scaffold", scaffold: plan.scaffold });
		}
		const at = (relative: string) => path.join(plan.directory, relative);
		for (const move of plan.moves) {
			if (signal.aborted) return err(stopped());
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
			if (signal.aborted) return err(stopped());
			const wrote = dryRun
				? ok(undefined)
				: await attempt(`Failed to write ${file.fileName}`, () =>
						log.writeFile(at(file.fileName), file.content)
					);
			if (wrote.isErr()) return wrote;
			written.push({ kind: "file", file });
		}
		// A dry run asks the folder as the files and moves would leave it, as the real run asks after making them.
		const folder: FileReader = dryRun
			? new DraftFileReader(this.fileSystemService, {
					files: new Map(
						plan.files.map(({ fileName }) => [at(fileName), ""])
					),
					directories: [],
					moves: plan.moves.map(({ from, to }) => ({
						from: at(from),
						to: at(to),
					})),
				})
			: this.fileSystemService;
		for (const directory of plan.directories) {
			if (signal.aborted) return err(stopped());
			const created = await attempt(
				`Failed to create ${directory}`,
				async () =>
					dryRun
						? !(await folder.exists(at(directory)))
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
		dryRun: boolean,
		signal: AbortSignal
	): Promise<Result<void, KindedError>> {
		if (dryRun) return ok(undefined);
		const created = await attempt(`Failed to create ${directory}`, () =>
			log.createDirectory(directory)
		);
		if (created.isErr()) return created;
		const failed = await log.recordAdded(directory, () =>
			this.failureOf(command, directory, signal)
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
		cwd: string,
		signal?: AbortSignal
	): Promise<string | undefined> {
		const file = await this.locator.find(command.file);
		if (!file) return `${command.file} isn't installed`;
		const ran = await this.processService.exec(file, command.args, {
			cwd,
			timeout: command.timeout,
			signal,
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
