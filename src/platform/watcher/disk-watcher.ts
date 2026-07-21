import chokidar from "chokidar";
import { Watcher, WatchRequest, FileChange, FileChangeType } from "./files.js";
import { Emitter, Event } from "../../base/event.js";
import { LogService } from "../log/log-service.js";

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
			`Starting disk file watcher on: ${targetPaths.join(", ")}`
		);

		this.watcher = chokidar.watch(targetPaths, {
			ignoreInitial: true,
			persistent: true,
			depth: requests.some((r) => r.recursive) ? undefined : 0,
		});

		this.watcher.on("add", (p) =>
			this.handleEvent(FileChangeType.ADDED, p)
		);
		this.watcher.on("change", (p) =>
			this.handleEvent(FileChangeType.UPDATED, p)
		);
		this.watcher.on("unlink", (p) =>
			this.handleEvent(FileChangeType.DELETED, p)
		);

		this.watcher.on("error", (error) => {
			this.logService.error(`Watcher crashed: ${error.message}`);
			this._onDidError.fire(error);
		});
	}

	private handleEvent(type: FileChangeType, path: string): void {
		this._onDidChangeFile.fire([{ type, path }]);
	}

	async stop(): Promise<void> {
		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
	}
}
