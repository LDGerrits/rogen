import path from "path";
import { DisposableStore } from "../../base/disposable.js";
import { toPosix } from "../../base/path.js";
import { MemoryFileSystemService } from "../fs/memory-file-system-service.js";
import { LogService } from "../log/log-service.js";
import { AbstractWatcher } from "./abstract-watcher.js";
import { WatchFilter, WatchOptions } from "./watcher.js";

/** `filePath` as a disk watcher reports it, with the drive Windows gives `/repo`. */
const onDisk = (filePath: string): string =>
	path.isAbsolute(filePath) ? path.resolve(filePath) : filePath;

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
		const filter = new WatchFilter(
			paths.map((watched) => toPosix(onDisk(watched))),
			options
		);

		this.fileSystemService.onDidMutateFile((change) => {
			const reported = toPosix(onDisk(change.path));
			if (!filter.reports(reported)) return;
			this.fireChange({
				type: change.type,
				path: reported,
				fileType: change.fileType,
			});
		}, this.subscriptions);
	}

	protected async stopWatching(): Promise<void> {
		this.subscriptions.clear();
	}
}
