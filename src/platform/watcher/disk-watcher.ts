import chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
import { FileType } from "../fs/file-system-service.js";
import { Emitter, Event } from "../../base/event.js";
import { LogService } from "../log/log-service.js";
import { toPosix } from "../../base/path.js";
import { FileChange, FileChangeType } from "../fs/file-events.js";
import { isIgnored } from "./ignored-paths.js";
import { Watcher, WatchOptions, WatchRequest } from "./watcher.js";

export class DiskWatcher implements Watcher {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeFile = new Emitter<FileChange[]>();
	readonly onDidChangeFile: Event<FileChange[]> = this._onDidChangeFile.event;

	private readonly _onDidError = new Emitter<Error>();
	readonly onDidError: Event<Error> = this._onDidError.event;

	private watcher: chokidar.FSWatcher | null = null;

	constructor(private readonly logService: LogService) {}

	async watch(
		requests: WatchRequest[],
		options: WatchOptions = {}
	): Promise<void> {
		await this.stop();

		const targetPaths = requests.map((r) => r.path);
		this.logService.debug(
			`Started watching paths: ${targetPaths.join(", ")}`
		);

		this.watcher = chokidar.watch(targetPaths, {
			ignoreInitial: true,
			persistent: true,
			depth: requests.some((r) => r.recursive) ? undefined : 0,
			followSymlinks: true,
			ignored: (target: string) =>
				isIgnored(target, options.ignored ?? []) ||
				linksToAncestor(target),
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

		// Until chokidar is ready, new files count as initial and are ignored.
		const watcher = this.watcher;
		await new Promise<void>((resolve) => watcher.once("ready", resolve));
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

// Following a link that points at an ancestor would report the tree again forever.
function linksToAncestor(target: string): boolean {
	try {
		if (!fs.lstatSync(target).isSymbolicLink()) return false;
		const real = fs.realpathSync(target);
		for (
			let ancestor = path.dirname(target);
			;
			ancestor = path.dirname(ancestor)
		) {
			if (fs.realpathSync(ancestor) === real) return true;
			if (path.dirname(ancestor) === ancestor) return false;
		}
	} catch {
		return false;
	}
}
