import { Watcher, WatchRequest, FileChange } from "./files.js";
import { Emitter, Event } from "../../base/event.js";
import { LogService } from "../log/log-service.js";
import { MemoryFileSystemService } from "../fs/memory-file-system-service.js";
import { toPosix } from "../../base/path.js";

export class MemoryWatcher implements Watcher {
	private readonly _onDidChangeFile = new Emitter<FileChange[]>();
	readonly onDidChangeFile: Event<FileChange[]> = this._onDidChangeFile.event;

	private readonly _onDidError = new Emitter<Error>();
	readonly onDidError: Event<Error> = this._onDidError.event;

	private activeRequests: WatchRequest[] = [];
	private fileSystemSubscription: { [Symbol.dispose](): void } | null = null;

	constructor(
		private readonly memoryFs: MemoryFileSystemService,
		private readonly logService: LogService
	) {}

	async watch(requests: WatchRequest[]): Promise<void> {
		this.activeRequests = requests.map((req) => ({
			...req,
			path: toPosix(req.path),
		}));

		this.logService.debug(
			`[MemoryWatcher] Listening to ${this.activeRequests.length} watch paths`
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
						this._onDidChangeFile.fire([
							{
								type: change.type,
								path: normalizedChangePath,
							},
						]);
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
	}
}
