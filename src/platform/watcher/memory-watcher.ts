import { Emitter, Event } from "../../base/event.js";
import { DisposableStore } from "../../base/disposable.js";
import { LogService } from "../log/log-service.js";
import { toPosix } from "../../base/path.js";
import { MemoryFileSystemService } from "../fs/memory-file-system-service.js";
import { FileChange } from "../fs/file-events.js";
import { isIgnored } from "./ignored-paths.js";
import { Watcher, WatchOptions, WatchRequest } from "./watcher.js";

export class MemoryWatcher implements Watcher {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeFile = new Emitter<FileChange[]>();
	readonly onDidChangeFile: Event<FileChange[]> = this._onDidChangeFile.event;

	private readonly _onDidError = new Emitter<Error>();
	readonly onDidError: Event<Error> = this._onDidError.event;

	private activeRequests: WatchRequest[] = [];
	private ignored: readonly string[] = [];
	private watchDisposables: DisposableStore | null = null;

	constructor(
		private readonly memoryFs: MemoryFileSystemService,
		private readonly logService: LogService
	) {}

	async watch(
		requests: WatchRequest[],
		options: WatchOptions = {}
	): Promise<void> {
		this.ignored = options.ignored ?? [];
		this.activeRequests = requests.map((req) => ({
			...req,
			path: toPosix(req.path),
		}));

		const targetPaths = requests.map((r) => r.path);
		this.logService.debug(
			`Started watching paths: ${targetPaths.join(", ")}`
		);

		if (!this.watchDisposables) {
			this.watchDisposables = new DisposableStore();

			this.memoryFs.onDidMutateFile((change) => {
				const normalizedChangePath = toPosix(change.path);
				if (isIgnored(normalizedChangePath, this.ignored)) return;

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
							fileType: change.fileType,
						},
					]);
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
