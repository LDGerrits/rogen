import {
	Watcher,
	WatchRequest,
	FileChange,
	normalizeFileChanges,
} from "./files.js";
import { Emitter, Event } from "../../base/event.js";
import { Disposable } from "../../base/disposable.js";
import { LogService } from "../log/log-service.js";
import { toPosix } from "../../base/path.js";
import { MemoryFileSystemService } from "../fs/memory-file-system-service.js";

export class MemoryWatcher implements Watcher {
	private readonly _onDidChangeFile = new Emitter<FileChange[]>();
	readonly onDidChangeFile: Event<FileChange[]> = this._onDidChangeFile.event;

	private readonly _onDidError = new Emitter<Error>();
	readonly onDidError: Event<Error> = this._onDidError.event;

	private activeRequests: WatchRequest[] = [];
	private fileSystemSubscription: Disposable | null = null;

	private batchedChanges: FileChange[] = [];
	private batchTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly BATCH_DELAY_MS = 50;

	constructor(
		private readonly memoryFs: MemoryFileSystemService,
		private readonly logService: LogService
	) {}

	async watch(requests: WatchRequest[]): Promise<void> {
		this.activeRequests = requests.map((req) => ({
			...req,
			path: toPosix(req.path),
		}));

		const targetPaths = requests.map((r) => r.path);
		this.logService.debug(
			`Started watching paths: ${targetPaths.join(", ")}`
		);

		if (!this.fileSystemSubscription) {
			this.fileSystemSubscription = this.memoryFs.onDidMutateFile(
				(change) => {
					const normalizedChangePath = toPosix(change.path);

					const isWatched = this.activeRequests.some((req) => {
						if (req.recursive) {
							return (
								normalizedChangePath === req.path ||
								normalizedChangePath.startsWith(req.path + "/")
							);
						}
						return normalizedChangePath === req.path;
					});

					if (isWatched) {
						this.queueChange({
							type: change.type,
							path: normalizedChangePath,
							fileType: change.fileType,
						});
					}
				}
			);
		}
	}

	private queueChange(change: FileChange) {
		this.batchedChanges.push(change);

		if (!this.batchTimer) {
			this.batchTimer = setTimeout(
				() => this.flushChanges(),
				this.BATCH_DELAY_MS
			);
		}
	}

	private flushChanges() {
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
		if (this.fileSystemSubscription) {
			this.fileSystemSubscription[Symbol.dispose]();
			this.fileSystemSubscription = null;
		}
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}
		this.activeRequests = [];
		this.batchedChanges = [];
	}
}
