import chokidar from "chokidar";
import * as fs from "fs";
import { isUnfollowableLink } from "../fs/disk-file-system-service.js";
import { FileType } from "../fs/file-system-service.js";
import { toPosix } from "../../base/path.js";
import { FileChangeType } from "../fs/file-changes.js";
import { AbstractWatcher } from "./abstract-watcher.js";
import { WatchFilter, WatchOptions } from "./watcher.js";

/** How often the roots are looked at again. */
const REVIVAL_INTERVAL_MS = 500;

/** What each event of chokidar reports. */
const CHOKIDAR_EVENTS = [
	["add", FileChangeType.ADDED, FileType.File],
	["addDir", FileChangeType.ADDED, FileType.Directory],
	["change", FileChangeType.UPDATED, FileType.File],
	["unlink", FileChangeType.DELETED, FileType.File],
	["unlinkDir", FileChangeType.DELETED, FileType.Directory],
] as const;

export class DiskWatcher extends AbstractWatcher {
	private watcher: chokidar.FSWatcher | null = null;
	/** Links seen that aren't followed; chokidar reports nothing about them, so their coming and going is reported here. */
	private unfollowed = new Set<string>();
	private ready = false;
	/** What the watch was asked to watch. */
	private roots: string[] = [];
	/** What each root was last seen as, to tell one that was replaced. */
	private readonly seen = new Map<string, string | undefined>();
	private revival: NodeJS.Timeout | undefined;
	/** Ends a start still waiting for chokidar, which never reports ready once closed. */
	private cancelStart: (() => void) | undefined;

	protected async startWatching(
		paths: readonly string[],
		options: WatchOptions
	): Promise<void> {
		const filter = new WatchFilter(paths, options);
		this.roots = [...paths, ...(options.shallow ?? [])];

		this.watcher = chokidar.watch(this.roots, {
			ignoreInitial: true,
			persistent: true,
			followSymlinks: true,
			ignored: (target: string) =>
				filter.skips(target) || this.skipUnfollowable(target),
		});

		for (const [event, type, fileType] of CHOKIDAR_EVENTS)
			this.watcher.on(event, (p) => this.fireEvent(type, p, fileType));

		// A link nothing descends into is never watched, so any activity rechecks the ones seen.
		this.watcher.on("raw", () => this.dropRemovedLinks());

		this.watcher.on("error", (error) =>
			this.logService.error(`DiskWatcher crashed: ${error.message}`)
		);

		// Until chokidar is ready, new files count as initial and are ignored.
		const watcher = this.watcher;
		await new Promise<void>((resolve) => {
			this.cancelStart = resolve;
			watcher.once("ready", resolve);
		});
		this.cancelStart = undefined;
		this.ready = true;
		this.watchForReturns();
	}

	/** Looks for the roots again every so often, and watches a root that came back or began as a new place afresh, since chokidar loses a root that was deleted and never sees one that did not exist. */
	private watchForReturns(): void {
		for (const root of this.roots) this.seen.set(root, identityOf(root));
		this.revival = setInterval(
			() => this.reviveRoots(),
			REVIVAL_INTERVAL_MS
		);
		this.revival.unref();
	}

	private reviveRoots(): void {
		for (const root of this.roots) {
			const now = identityOf(root);
			if (now === this.seen.get(root)) continue;
			this.seen.set(root, now);
			if (now === undefined) continue;
			this.watcher?.add(root);
			this.fireEvent(
				FileChangeType.ADDED,
				root,
				fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()
					? FileType.Directory
					: FileType.File
			);
		}
	}

	private stopRevival(): void {
		clearInterval(this.revival);
		this.revival = undefined;
	}

	/** Doesn't wait for a start's initial scan to finish. */
	override stop(): Promise<void> {
		this.cancelStart?.();
		return super.stop();
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

	protected async stopWatching(): Promise<void> {
		this.ready = false;
		this.stopRevival();
		this.seen.clear();
		this.unfollowed = new Set();
		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
	}
}

/** Which file or folder `target` is now, so one deleted and made again differs from the one before; `undefined` when it isn't there. */
function identityOf(target: string): string | undefined {
	const stats = fs.statSync(target, { throwIfNoEntry: false });
	return stats && `${stats.ino}:${stats.birthtimeMs}`;
}

function isSymbolicLink(target: string): boolean {
	try {
		return fs.lstatSync(target).isSymbolicLink();
	} catch {
		return false;
	}
}
