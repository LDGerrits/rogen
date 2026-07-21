import chokidar from "chokidar";
import {
	Watcher,
	WatchRequest,
	FileChange,
	FileChangeType,
	normalizeFileChanges,
} from "./files.js";
import { FileType } from "../fs/file-system-service.js";
import { Emitter, Event } from "../../base/event.js";
import { LogService } from "../log/log-service.js";
import { toPosix } from "../../base/path.js";

export class DiskWatcher implements Watcher {
	private readonly _onDidChangeFile = new Emitter<FileChange[]>();
	readonly onDidChangeFile: Event<FileChange[]> = this._onDidChangeFile.event;

	private readonly _onDidError = new Emitter<Error>();
	readonly onDidError: Event<Error> = this._onDidError.event;

	private watcher: chokidar.FSWatcher | null = null;

	private batchedChanges: FileChange[] = [];
	private batchTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly BATCH_DELAY_MS = 50;

	constructor(private readonly logService: LogService) {}

	async watch(requests: WatchRequest[]): Promise<void> {
		await this.stop();

		const targetPaths = requests.map((r) => r.path);
		this.logService.debug(
			`Started watching paths: ${targetPaths.join(", ")}`
		);

		this.watcher = chokidar.watch(targetPaths, {
			ignoreInitial: true,
			persistent: true,
			depth: requests.some((r) => r.recursive) ? undefined : 0,
			followSymlinks: false,
		});

		this.watcher.on("add", (p) =>
			this.queueEvent(FileChangeType.ADDED, p, FileType.File)
		);
		this.watcher.on("addDir", (p) =>
			this.queueEvent(FileChangeType.ADDED, p, FileType.Directory)
		);
		this.watcher.on("change", (p) =>
			this.queueEvent(FileChangeType.UPDATED, p, FileType.File)
		);
		this.watcher.on("unlink", (p) =>
			this.queueEvent(FileChangeType.DELETED, p, FileType.File)
		);
		this.watcher.on("unlinkDir", (p) =>
			this.queueEvent(FileChangeType.DELETED, p, FileType.Directory)
		);

		this.watcher.on("error", (error) => {
			this.logService.error(`DiskWatcher crashed: ${error.message}`);
			this._onDidError.fire(error);
		});
	}

	private queueEvent(
		type: FileChangeType,
		rawPath: string,
		fileType: FileType
	): void {
		this.batchedChanges.push({ type, path: toPosix(rawPath), fileType });

		if (!this.batchTimer) {
			this.batchTimer = setTimeout(
				() => this.flushEvents(),
				this.BATCH_DELAY_MS
			);
		}
	}

	private flushEvents(): void {
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}

		if (this.batchedChanges.length > 0) {
			const normalized = normalizeFileChanges(this.batchedChanges);
			this.batchedChanges = [];

			if (normalized.length > 0) {
				this._onDidChangeFile.fire(normalized);
			}
		}
	}

	async stop(): Promise<void> {
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}
		this.batchedChanges = [];

		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
	}
}
