import chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
import { FileType } from "../fs/file-system-service.js";
import { toPosix } from "../../base/path.js";
import { FileChangeType } from "../fs/file-changes.js";
import { AbstractWatcher } from "./abstract-watcher.js";
import { isIgnored, WatchOptions, WatchRequest } from "./watcher.js";

export class DiskWatcher extends AbstractWatcher {
	private watcher: chokidar.FSWatcher | null = null;

	protected async startWatching(
		requests: WatchRequest[],
		options: WatchOptions
	): Promise<void> {
		await this.stop();

		const targetPaths = requests.map((r) => r.path);

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
			this.fireError(error);
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
		this.fireChange({ type, path: toPosix(rawPath), fileType });
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
