import { DisposableStore } from "../../base/disposable.js";
import { containsPosix, toPosix } from "../../base/path.js";
import { MemoryFileSystemService } from "../fs/memory-file-system-service.js";
import { LogService } from "../log/log-service.js";
import { AbstractWatcher } from "./abstract-watcher.js";
import {
	IgnoredPath,
	isIgnored,
	WatchOptions,
	WatchRequest,
} from "./watcher.js";

export class MemoryWatcher extends AbstractWatcher {
	private activeRequests: WatchRequest[] = [];
	private ignored: readonly IgnoredPath[] = [];
	private watchDisposables: DisposableStore | null = null;

	constructor(
		private readonly memoryFs: MemoryFileSystemService,
		logService: LogService
	) {
		super(logService);
	}

	protected async startWatching(
		requests: WatchRequest[],
		options: WatchOptions
	): Promise<void> {
		this.ignored = options.ignored ?? [];
		this.activeRequests = requests.map((req) => ({
			...req,
			path: toPosix(req.path),
		}));

		if (!this.watchDisposables) {
			this.watchDisposables = new DisposableStore();

			this.memoryFs.onDidMutateFile((change) => {
				const normalizedChangePath = toPosix(change.path);
				if (isIgnored(normalizedChangePath, this.ignored)) return;

				const isWatched = this.activeRequests.some((req) =>
					req.recursive
						? containsPosix(req.path, normalizedChangePath)
						: normalizedChangePath === req.path
				);

				if (isWatched) {
					this.fireChange({
						type: change.type,
						path: normalizedChangePath,
						fileType: change.fileType,
					});
				}
			}, this.watchDisposables);
		}
	}

	async stop(): Promise<void> {
		if (this.watchDisposables) {
			this.watchDisposables[Symbol.dispose]();
			this.watchDisposables = null;
		}
		this.activeRequests = [];
		this.ignored = [];
	}
}
