import path from "path";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
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
		private readonly pid: number,
		/** The project folder, absolute, in the system's own form. */
		readonly dir: string
	) {
		this.file = path.join(dir, SYNCBACK_FILES.project);
		this.folder = path.join(dir, SYNCBACK_FILES.staging);
		this.lock = path.join(this.folder, LOCK);
	}

	/** Runs `work` while this process owns the staging files, which it finds clean and leaves gone; `syncback.busy` when another syncback owns them, with nothing touched. */
	async use<T>(
		work: () => Promise<Result<T, Error>>
	): Promise<Result<T, Error>> {
		const locked = await this.take();
		if (locked.isErr()) return locked;
		try {
			await this.clean();
			return await work();
		} finally {
			await this.release();
		}
	}

	/** Removes what an earlier run left, except the lock. */
	async clean(): Promise<void> {
		await this.fileSystemService.delete(this.file).catch(() => undefined);
		for (const [name] of await this.fileSystemService
			.readDirectory(this.folder)
			.catch(() => []))
			if (name !== LOCK)
				await this.fileSystemService
					.delete(path.join(this.folder, name), true)
					.catch(() => undefined);
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

	private async release(): Promise<void> {
		await this.clean();
		await this.fileSystemService
			.delete(this.folder, true)
			.catch(() => undefined);
	}
}
