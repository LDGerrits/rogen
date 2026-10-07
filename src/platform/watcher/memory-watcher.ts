import { DisposableStore } from "../../base/disposable.js";
import { containsPosix, toPosix } from "../../base/path.js";
import { MemoryFileSystemService } from "../fs/memory-file-system-service.js";
import { LogService } from "../log/log-service.js";
import { AbstractWatcher } from "./abstract-watcher.js";
import { IgnoredPath, isIgnored, WatchOptions } from "./watcher.js";

export class MemoryWatcher extends AbstractWatcher {
	private watched: readonly string[] = [];
	private ignored: readonly IgnoredPath[] = [];
	private watchDisposables: DisposableStore | null = null;

	constructor(
		private readonly memoryFs: MemoryFileSystemService,
		logService: LogService
	) {
		super(logService);
	}

	protected async startWatching(
		paths: readonly string[],
		options: WatchOptions
	): Promise<void> {
		this.ignored = options.ignored ?? [];
		this.watched = paths.map(toPosix);

		this.watchDisposables = new DisposableStore();

		this.memoryFs.onDidMutateFile((change) => {
			const normalizedChangePath = toPosix(change.path);
			if (isIgnored(normalizedChangePath, this.ignored)) return;

			const isWatched = this.watched.some((watched) =>
				containsPosix(watched, normalizedChangePath)
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

	protected async stopWatching(): Promise<void> {
		if (this.watchDisposables) {
			this.watchDisposables[Symbol.dispose]();
			this.watchDisposables = null;
		}
		this.watched = [];
		this.ignored = [];
	}
}
