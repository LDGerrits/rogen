import { Watcher, WatchRequest, FileChange } from "./files.js";
import { Emitter, Event } from "../../base/event.js";
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
	private batchTimer: ReturnType<typeof setTimeout> | null = null;
	private batchedChanges = new Map<string, FileChange>();

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
			`Starting memory file watcher on: ${targetPaths.join(", ")}`
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
						});
					}
				}
			);
		}
	}

	async stop(): Promise<void> {
		if (this.fileSystemSubscription) {
			this.fileSystemSubscription[Symbol.dispose]();
			this.fileSystemSubscription = null;
		}
		this.activeRequests = [];
		this.flushChanges();
	}

	private queueChange(change: FileChange) {
		this.batchedChanges.set(change.path, change);

		if (!this.batchTimer) {
			// Batch events over a tick for emulation
			this.batchTimer = setTimeout(() => this.flushChanges(), 0);
		}
	}

	private flushChanges() {
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}

		if (this.batchedChanges.size > 0) {
			const changes = Array.from(this.batchedChanges.values());
			this.batchedChanges.clear();
			this._onDidChangeFile.fire(changes);
		}
	}
}
