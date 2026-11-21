import path from "path";
import { IoError, failureReason } from "../../base/errors.js";
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

export const MIRROR = `${SYNCBACK_FILES.staging}/mirror`;

const LOCK = "lock";

const NEW_LOCK_MS = 5000;

export class SyncbackStaging {
	readonly file: string;
	readonly mirror: string;
	private readonly folder: string;
	private readonly lock: string;

	constructor(
		private readonly pid: number,
		readonly dir: string,
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@ProcessService private readonly processService: ProcessService,
		@LifecycleService private readonly lifecycleService: LifecycleService
	) {
		this.file = path.join(dir, SYNCBACK_FILES.project);
		this.folder = path.join(dir, SYNCBACK_FILES.staging);
		this.mirror = path.join(dir, MIRROR);
		this.lock = path.join(this.folder, LOCK);
	}

	async use<T>(
		work: (signal: AbortSignal) => Promise<Result<T, Error>>
	): Promise<Result<T, Error>> {
		const locked = await this.take();
		if (locked.isErr()) return locked;
		const stopping = new AbortController();
		let cleaning: Promise<unknown> | undefined;
		const shutdown = this.lifecycleService.onWillShutdown(() => {
			stopping.abort();
			cleaning = this.clean();
		});
		try {
			const cleaned = await this.clean();
			if (cleaned.isErr()) return cleaned;
			return await work(stopping.signal);
		} finally {
			shutdown[Symbol.dispose]();
			await cleaning;
			await this.release();
		}
	}

	private async clean(): Promise<Result<void, Error>> {
		const removed = await this.remove(this.file);
		if (removed.isErr()) return removed;
		return this.remove(this.mirror);
	}

	private async remove(target: string): Promise<Result<void, Error>> {
		const removed = await tryWithAsync(() =>
			this.fileSystemService.delete(target, true)
		);
		return removed.isErr()
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
		const found = await this.holder(this.lock);
		if (found.held) return err(this.busy(found.owner));
		const claimed = `${this.lock}.${this.pid}`;
		const claim = await tryWithAsync(() =>
			this.fileSystemService.rename(this.lock, claimed)
		);
		if (claim.isOk()) {
			const madeMeanwhile = await this.holder(claimed);
			if (madeMeanwhile.held) {
				await this.fileSystemService
					.rename(claimed, this.lock)
					.catch(() => undefined);
				return err(this.busy(madeMeanwhile.owner));
			}
			await this.fileSystemService.delete(claimed).catch(() => undefined);
		}
		if (await this.create()) return ok(undefined);
		return err(this.busy(await this.owner(this.lock)));
	}

	private async create(): Promise<boolean> {
		const createLock = () =>
			this.fileSystemService.createFile(this.lock, String(this.pid));
		try {
			return await createLock();
		} catch (error) {
			const folderReleasedMeanwhile = isMissingPath(error as Error);
			if (!folderReleasedMeanwhile) throw error;
			return createLock();
		}
	}

	private async holder(
		file: string
	): Promise<{ held: boolean; owner?: number }> {
		const owner = await this.owner(file);
		// A lock naming this process was left by an earlier one whose id it
		// reuses.
		if (owner !== undefined)
			return {
				held:
					owner !== this.pid && this.processService.isRunning(owner),
				owner,
			};
		const modified = await tryWithAsync(() =>
			this.fileSystemService.lastModified(file)
		);
		return {
			held: modified.isOk() && Date.now() - modified.value < NEW_LOCK_MS,
		};
	}

	private async owner(file: string): Promise<number | undefined> {
		const read = await tryWithAsync(() =>
			this.fileSystemService.readFile(file)
		);
		const pid = read.isOk() ? Number(read.value.trim()) : NaN;
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	}

	private busy(owner: number | undefined): DiagnosticsError {
		return new DiagnosticsError([
			errorDiagnostic(
				"syncback.busy",
				{ resource: this.dir },
				`another rogen syncback${owner === undefined ? "" : ` (process ${owner})`} is running in this folder, so this one stopped. Wait for it to end, or remove ${SYNCBACK_FILES.staging}/${LOCK} if none is running.`
			),
		]);
	}

	private async release(): Promise<void> {
		await this.clean();
		await this.remove(this.folder);
	}
}
