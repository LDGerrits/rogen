import { DisposableStore } from "../../base/disposable.js";
import { toPosix } from "../../base/path.js";
import { MemoryFileSystemService } from "../fs/memory-file-system-service.js";
import { LogService } from "../log/log-service.js";
import { AbstractWatcher } from "./abstract-watcher.js";
import { WatchFilter, WatchOptions } from "./watcher.js";

export class MemoryWatcher extends AbstractWatcher {
	private readonly subscriptions = this._register(new DisposableStore());

	constructor(
		private readonly fileSystemService: MemoryFileSystemService,
		logService: LogService
	) {
		super(logService);
	}

	protected async startWatching(
		paths: readonly string[],
		options: WatchOptions
	): Promise<void> {
		const filter = new WatchFilter(paths, options);

		this.fileSystemService.onDidMutateFile((change) => {
			if (!filter.reports(change.path)) return;
			this.fireChange({
				type: change.type,
				path: toPosix(change.path),
				fileType: change.fileType,
			});
		}, this.subscriptions);
	}

	protected async stopWatching(): Promise<void> {
		this.subscriptions.clear();
	}
}
