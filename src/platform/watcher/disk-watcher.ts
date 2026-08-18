import chokidar from "chokidar";
import { FileType } from "../fs/file-system-service.js";
import { Emitter, Event } from "../../base/event.js";
import { LogService } from "../log/log-service.js";
import { toPosix } from "../../base/path.js";
import { FileChange, FileChangeType } from "../fs/file-events.js";
import { Watcher, WatchRequest } from "./watcher.js";

export class DiskWatcher implements Watcher {
	private readonly _onDidChangeFile = new Emitter<FileChange[]>();
	readonly onDidChangeFile: Event<FileChange[]> = this._onDidChangeFile.event;

	private readonly _onDidError = new Emitter<Error>();
	readonly onDidError: Event<Error> = this._onDidError.event;

	private watcher: chokidar.FSWatcher | null = null;

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
			this.fireEvent(FileChangeType.ADDED, p, FileType.File)
		);
		this.watcher.on("addDir", (p) =>
			this.fireEvent(FileChangeType.ADDED, p, FileType.Directory)
		);
		this.watcher.on("change", (p) =>
			this.fireEvent(FileChangeType.UPDATED, p, FileType.File)
		);
		this.watcher.on("unlink", (p) =>
			this.fireEvent(FileChangeType.DELETED, p, FileType.File)
		);
		this.watcher.on("unlinkDir", (p) =>
			this.fireEvent(FileChangeType.DELETED, p, FileType.Directory)
		);

		this.watcher.on("error", (error) => {
			this.logService.error(`DiskWatcher crashed: ${error.message}`);
			this._onDidError.fire(error);
		});
	}

	private fireEvent(
		type: FileChangeType,
		rawPath: string,
		fileType: FileType
	): void {
		this._onDidChangeFile.fire([
			{ type, path: toPosix(rawPath), fileType },
		]);
	}

	async stop(): Promise<void> {
		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
	}
}
