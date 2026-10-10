import { DisposableStore } from "../../base/disposable.js";
import { toPosix } from "../../base/path.js";
import { MemoryFileSystemService } from "../fs/memory-file-system-service.js";
import { LogService } from "../log/log-service.js";
import { AbstractWatcher } from "./abstract-watcher.js";
import { WatchFilter, WatchOptions } from "./watcher.js";

export class MemoryWatcher extends AbstractWatcher {
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
		const filter = new WatchFilter(paths, options);
		this.watchDisposables = new DisposableStore();

		this.memoryFs.onDidMutateFile((change) => {
			if (!filter.reports(change.path)) return;
			this.fireChange({
				type: change.type,
				path: toPosix(change.path),
				fileType: change.fileType,
			});
		}, this.watchDisposables);
	}

	protected async stopWatching(): Promise<void> {
		if (this.watchDisposables) {
			this.watchDisposables[Symbol.dispose]();
			this.watchDisposables = null;
		}
	}
}
