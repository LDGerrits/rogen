import path from "path";
import { firstLine } from "../../base/strings.js";
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
		for (const move of plan.moves) {
			const moved = await tryWithAsync(async () => {
				if (!dryRun)
					await this.fileSystemService.rename(
						path.join(plan.directory, move.from),
						path.join(plan.directory, move.to)
					);
			});
			if (moved.isErr())
				return err(
					ErrorUtils.wrap(
						`Failed to rename ${move.from} to ${move.to}`,
						moved.error
					)
				);
			onWritten({ kind: "move", move });
		}
		for (const file of plan.files) {
			const { fileName, content } = file;
			const written = await tryWithAsync(async () => {
				if (!dryRun)
					await this.fileSystemService.writeFile(
						path.join(plan.directory, fileName),
						content
					);
			});
			if (written.isErr()) {
				return err(
					ErrorUtils.wrap(
						`Failed to write ${fileName}`,
						written.error
					)
				);
			}
			onWritten({ kind: "file", file });
		}
		for (const directory of plan.directories) {
			const created = await tryWithAsync(async () => {
				const target = path.join(plan.directory, directory);
				if (await this.fileSystemService.exists(target)) return false;
				if (!dryRun)
					await this.fileSystemService.createDirectory(target);
				return true;
			});
			if (created.isErr()) {
				return err(
					ErrorUtils.wrap(
						`Failed to create ${directory}`,
						created.error
					)
				);
			}
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

	/** Runs the tool, then removes what it wrote that `init` replaces; the tool failing is an error with the command to run by hand, since a project without its files is not what was asked for. */
	private async scaffold(
		{ command, replaces }: PlannedScaffold,
		directory: string,
		dryRun: boolean
	): Promise<Result<void, Error>> {
		if (dryRun) return ok(undefined);
		const failed = await this.failureOf(command, directory);
		if (failed !== undefined)
			return err(
				new ToolError(
					`'${command.command}' failed: ${failed}.`,
					`Run it in ${directory} yourself, then run 'rogen init' again.`
				)
			);
		const removed = await tryWithAsync(async () => {
			for (const file of replaces) {
				const target = path.join(directory, file);
				if (await this.fileSystemService.exists(target))
					await this.fileSystemService.delete(target, true);
			}
		});
		return removed.isErr()
			? err(ErrorUtils.wrap("Failed to clear the starter", removed.error))
			: ok(undefined);
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
