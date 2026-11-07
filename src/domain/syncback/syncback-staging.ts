import path from "path";
import { CancelledError, IoError, failureReason } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import {
	FileSystemService,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { SYNCBACK_FILES } from "../config/config.js";

/** The file in the staging folder that holds the id of the process that owns it. */
const LOCK = "lock";

/** The staging files of a project folder, which one syncback at a time owns: it locks them, cleans them, works in them, and releases them. */
export class SyncbackStaging {
	/** The temporary project file Rojo runs on. */
	readonly file: string;
	/** The folder the mirror and the lock are in. */
	readonly folder: string;
	private readonly lock: string;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly processService: ProcessService,
		private readonly lifecycleService: LifecycleService,
		private readonly pid: number,
		/** The project folder, absolute, in the system's own form. */
		readonly dir: string
	) {
		this.file = path.join(dir, SYNCBACK_FILES.project);
		this.folder = path.join(dir, SYNCBACK_FILES.staging);
		this.lock = path.join(this.folder, LOCK);
	}

	/** Runs `work` while this process owns the staging files, which it finds clean and leaves gone; `syncback.busy` when another syncback owns them, with nothing touched. A shutdown aborts `work`'s signal and removes the files at once. */
	async use<T>(
		work: (signal: AbortSignal) => Promise<Result<T, Error>>
	): Promise<Result<T, Error>> {
		const locked = await this.take();
		if (locked.isErr()) return locked;
		const stopping = new AbortController();
		let released: Promise<void> | undefined;
		const shutdown = this.lifecycleService.onWillShutdown(() => {
			stopping.abort();
			released = this.release();
		});
		try {
			const cleaned = await this.clean();
			if (cleaned.isErr()) return cleaned;
			const done = await work(stopping.signal);
			if (stopping.signal.aborted)
				return err(
					new CancelledError(
						"Syncback stopped before it finished, so nothing was written."
					)
				);
			return done;
		} finally {
			shutdown[Symbol.dispose]();
			await released;
			// After a shutdown, what the work wrote since is removed too, unless another run took the folder.
			if (await this.isOursOrFree()) await this.release();
		}
	}

	/** Removes what an earlier run left, except the lock; an error, with nothing copied, when something can't be removed. */
	async clean(): Promise<Result<void, Error>> {
		const removed = await this.remove(this.file);
		if (removed.isErr()) return removed;
		const entries = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(this.folder)
		);
		if (entries.isErr())
			return isMissingPath(entries.error)
				? ok(undefined)
				: err(this.uncleared(this.folder, entries.error));
		for (const [name] of entries.value) {
			if (name === LOCK) continue;
			const left = await this.remove(path.join(this.folder, name));
			if (left.isErr()) return left;
		}
		return ok(undefined);
	}

	private async remove(target: string): Promise<Result<void, Error>> {
		const removed = await tryWithAsync(() =>
			this.fileSystemService.delete(target, true)
		);
		return removed.isErr() && !isMissingPath(removed.error)
			? err(this.uncleared(target, removed.error))
			: ok(undefined);
	}

	private uncleared(target: string, error: Error): IoError {
		return new IoError(
			`${target} is left from an earlier syncback and could not be removed: ${failureReason(error)}.`,
			"Remove it, then run syncback again."
		);
	}

	private async take(): Promise<Result<void, DiagnosticsError>> {
		if (await this.create()) return ok(undefined);
		const owner = await this.owner();
		if (owner !== undefined && this.processService.isRunning(owner))
			return err(this.busy(owner));
		// The owner was killed before it released the lock; one of two runs taking it over wins.
		await this.fileSystemService.delete(this.lock).catch(() => undefined);
		if (await this.create()) return ok(undefined);
		return err(this.busy(await this.owner()));
	}

	private create(): Promise<boolean> {
		return this.fileSystemService.createFile(this.lock, String(this.pid));
	}

	/** The id the lock holds; none when it can't be read as one. */
	private async owner(): Promise<number | undefined> {
		const read = await tryWithAsync(() =>
			this.fileSystemService.readFile(this.lock)
		);
		const pid = read.isOk() ? Number(read.value.trim()) : NaN;
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	}

	private busy(owner: number | undefined): DiagnosticsError {
		return new DiagnosticsError([
			errorDiagnostic(
				"syncback.busy",
				{ resource: this.dir },
				`another rogen syncback${owner === undefined ? "" : `, process ${owner},`} is running in this folder, so this one stopped before it touched anything. Wait for it to end, then run syncback again.`
			),
		]);
	}

	private async isOursOrFree(): Promise<boolean> {
		if (!(await this.fileSystemService.exists(this.lock))) return true;
		return (await this.owner()) === this.pid;
	}

	private async release(): Promise<void> {
		await this.clean();
		await this.fileSystemService
			.delete(this.folder, true)
			.catch(() => undefined);
	}
}
