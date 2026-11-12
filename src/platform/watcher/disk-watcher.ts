import chokidar from "chokidar";
import * as fs from "fs";
import path from "path";
import { isUnfollowableLink } from "../fs/disk-file-system-service.js";
import { FileType } from "../fs/file-system-service.js";
import { ErrorUtils } from "../../base/errors.js";
import { containsPath, toPosix } from "../../base/path.js";
import { FileChange, FileChangeType } from "../fs/file-changes.js";
import { LogService } from "../log/log-service.js";
import { AbstractWatcher } from "./abstract-watcher.js";
import { WatchFilter, WatchOptions } from "./watcher.js";
import { InstantiationService } from "../instantiation/instantiation-service.js";

const REVIVAL_INTERVAL_MS = 500;

const CHOKIDAR_EVENTS = [
	["add", FileChangeType.ADDED, FileType.File],
	["addDir", FileChangeType.ADDED, FileType.Directory],
	["change", FileChangeType.UPDATED, FileType.File],
	["unlink", FileChangeType.DELETED, FileType.File],
	["unlinkDir", FileChangeType.DELETED, FileType.Directory],
] as const;

export class DiskWatcher extends AbstractWatcher {
	private session: WatchSession | undefined;

	constructor(
		@LogService logService: LogService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {
		super(logService);
	}

	protected async startWatching(
		paths: readonly string[],
		options: WatchOptions
	): Promise<void> {
		this.session = this.instantiationService.createInstance(
			WatchSession,
			[...paths, ...(options.shallow ?? [])],
			new WatchFilter(paths, options),
			options.reportsUnreadable ?? [],
			(change) => this.fireChange(change)
		);
		await this.session.start();
	}

	override stop(): Promise<void> {
		this.session?.cancelStart();
		return super.stop();
	}

	protected async stopWatching(): Promise<void> {
		const { session } = this;
		this.session = undefined;
		await session?.close();
	}
}

/** One watch, from its start to its stop; nothing it saw outlives it. */
class WatchSession {
	private readonly watcher: chokidar.FSWatcher;
	/** Links seen that aren't followed; chokidar reports nothing about them, so their coming and going is reported here. */
	private readonly unfollowed = new Set<string>();
	private ready = false;
	private closed = false;
	private readonly seen = new Map<string, string | undefined>();
	/** Folders chokidar could not read; chokidar reports nothing when one becomes readable, so that is reported here. */
	private readonly refused = new Set<string>();
	/** Paths handed back to chokidar and not yet reported, with the tick that did it: they are reported added a tick later, once watched, so what appears in them meanwhile is not lost. */
	private readonly attaching = new Map<
		string,
		{ fileType: FileType; tick: number }
	>();
	private tick = 0;
	private revival: NodeJS.Timeout | undefined;
	/** Ends a start still waiting for chokidar, which never reports ready once closed. */
	private cancel: (() => void) | undefined;

	constructor(
		private readonly roots: readonly string[],
		filter: WatchFilter,
		reportsUnreadable: readonly string[],
		private readonly fire: (change: FileChange) => void,
		@LogService private readonly logService: LogService
	) {
		this.watcher = chokidar.watch([...roots], {
			ignoreInitial: true,
			persistent: true,
			followSymlinks: true,
			ignored: (target: string) =>
				filter.skips(target) || this.skipUnfollowable(target),
		});

		for (const [event, type, fileType] of CHOKIDAR_EVENTS)
			this.watcher.on(event, (p) => this.fireEvent(type, p, fileType));

		this.watcher.on("raw", () => this.dropRemovedLinks());

		this.watcher.on("error", (error) => {
			this.recordRefused(error);
			this.reportError(error, reportsUnreadable);
		});
	}

	async start(): Promise<void> {
		// Until chokidar is ready, new files count as initial and are ignored.
		const cancelled = await new Promise<boolean>((resolve) => {
			this.cancel = () => resolve(true);
			this.watcher.once("ready", () => resolve(false));
		});
		this.cancel = undefined;
		if (cancelled || this.closed) return;
		this.ready = true;
		this.watchForReturns();
	}

	cancelStart(): void {
		this.cancel?.();
	}

	async close(): Promise<void> {
		this.closed = true;
		clearInterval(this.revival);
		clearThrottles(this.watcher);
		await this.watcher.close();
	}

	private reportError(error: Error, reported: readonly string[]): void {
		const message = `Can't watch part of the project: ${error.message}`;
		if (!ErrorUtils.hasCode(error, "EACCES", "EPERM"))
			this.logService.error(message);
		else if (isUnder(error, reported)) this.logService.debug(message);
		else this.logService.warn(message);
	}

	private recordRefused(error: Error): void {
		const { path: failed } = error as NodeJS.ErrnoException;
		if (
			failed !== undefined &&
			ErrorUtils.hasCode(error, "EACCES", "EPERM")
		)
			this.refused.add(failed);
	}

	/** Rewatches roots that came back or began as a new place, and folders that became readable: chokidar sees none of them. */
	private watchForReturns(): void {
		for (const root of this.roots) this.seen.set(root, identityOf(root));
		this.revival = setInterval(() => {
			this.tick++;
			this.reviveRoots();
			this.reviveRefused();
			this.reportAttached();
		}, REVIVAL_INTERVAL_MS);
		this.revival.unref();
	}

	private reviveRoots(): void {
		for (const root of this.roots) {
			const now = identityOf(root);
			if (now === this.seen.get(root)) continue;
			this.seen.set(root, now);
			if (now === undefined) continue;
			this.rewatch(
				root,
				fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()
					? FileType.Directory
					: FileType.File
			);
		}
	}

	private reviveRefused(): void {
		for (const dir of this.refused) {
			try {
				fs.readdirSync(dir);
			} catch (error) {
				if (!ErrorUtils.hasCode(error, "EACCES", "EPERM"))
					this.refused.delete(dir);
				continue;
			}
			this.refused.delete(dir);
			this.rewatch(dir, FileType.Directory);
		}
	}

	private rewatch(target: string, fileType: FileType): void {
		this.watcher.add(target);
		this.attaching.set(target, { fileType, tick: this.tick });
	}

	private reportAttached(): void {
		if (this.attaching.size === 0) return;
		const watched = this.watcher.getWatched();
		for (const [target, { fileType, tick }] of this.attaching) {
			if (tick === this.tick) continue;
			const attached =
				fileType === FileType.Directory
					? watched[target] !== undefined
					: watched[path.dirname(target)]?.includes(
							path.basename(target)
						);
			if (!attached) continue;
			this.attaching.delete(target);
			this.fireEvent(FileChangeType.ADDED, target, fileType);
		}
	}

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
		if (this.closed) return;
		this.fire({ type, path: toPosix(rawPath), fileType });
	}
}

/** chokidar forgets its throttle timers on close without clearing them, which keeps the process alive for up to a second. */
function clearThrottles(watcher: chokidar.FSWatcher): void {
	const { _throttled: throttled } = watcher as unknown as {
		readonly _throttled?: ReadonlyMap<
			string,
			ReadonlyMap<string, { clear(): unknown }>
		>;
	};
	for (const actions of throttled?.values() ?? [])
		for (const { clear } of [...actions.values()]) clear();
}

/** Whether the failed path of `error` lies in one of `dirs`. */
function isUnder(error: Error, dirs: readonly string[]): boolean {
	const failed = (error as NodeJS.ErrnoException).path;
	return (
		failed !== undefined &&
		dirs.some((dir) => containsPath(toPosix(dir), toPosix(failed)))
	);
}

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
