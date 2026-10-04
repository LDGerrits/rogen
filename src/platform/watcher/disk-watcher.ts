import chokidar from "chokidar";
import * as fs from "fs";
import { isUnfollowableLink } from "../fs/disk-file-system-service.js";
import { FileType } from "../fs/file-system-service.js";
import { toPosix } from "../../base/path.js";
import { FileChangeType } from "../fs/file-changes.js";
import { AbstractWatcher } from "./abstract-watcher.js";
import { isIgnored, WatchOptions, WatchRequest } from "./watcher.js";

export class DiskWatcher extends AbstractWatcher {
	private watcher: chokidar.FSWatcher | null = null;
	/** Links seen that aren't followed; chokidar reports nothing about them, so their coming and going is reported here. */
	private unfollowed = new Set<string>();
	private ready = false;

	protected async startWatching(
		requests: WatchRequest[],
		options: WatchOptions
	): Promise<void> {
		await this.stop();

		const targetPaths = requests.map((r) => r.path);
		const ignored = options.ignored ?? [];

		this.watcher = chokidar.watch(targetPaths, {
			ignoreInitial: true,
			persistent: true,
			depth: requests.some((r) => r.recursive) ? undefined : 0,
			followSymlinks: true,
			ignored: (target: string) =>
				isIgnored(target, ignored) || this.skipUnfollowable(target),
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

		// A link nothing descends into is never watched, so any activity rechecks the ones seen.
		this.watcher.on("raw", () => this.dropRemovedLinks());

		this.watcher.on("error", (error) => {
			this.logService.error(`DiskWatcher crashed: ${error.message}`);
			this.fireError(error);
		});

		// Until chokidar is ready, new files count as initial and are ignored.
		const watcher = this.watcher;
		await new Promise<void>((resolve) => watcher.once("ready", resolve));
		this.ready = true;
	}

	/** Skips a link that can't be followed and reports it once, as a link, after the initial scan. */
	private skipUnfollowable(target: string): boolean {
		if (!isUnfollowableLink(target)) return false;
		const posixTarget = toPosix(target);
		if (!this.unfollowed.has(posixTarget)) {
			this.unfollowed.add(posixTarget);
			if (this.ready)
				this.fireEvent(
					FileChangeType.ADDED,
					target,
					FileType.SymbolicLink
				);
		}
		return true;
	}

	private dropRemovedLinks(): void {
		for (const link of this.unfollowed) {
			if (isSymbolicLink(link)) continue;
			this.unfollowed.delete(link);
			this.fireEvent(FileChangeType.DELETED, link, FileType.SymbolicLink);
		}
	}

	private fireEvent(
		type: FileChangeType,
		rawPath: string,
		fileType: FileType
	): void {
		this.fireChange({ type, path: toPosix(rawPath), fileType });
	}

	async stop(): Promise<void> {
		this.ready = false;
		this.unfollowed = new Set();
		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
	}
}

function isSymbolicLink(target: string): boolean {
	try {
		return fs.lstatSync(target).isSymbolicLink();
	} catch {
		return false;
	}
}
