import path from "path";
import { containsPath, toPosix } from "../../base/path.js";
import { Event } from "../../base/event.js";
import { FileChange } from "../fs/file-changes.js";
import { createDecorator } from "../instantiation/instantiation.js";

export type IgnoredPath = string | RegExp;

export interface WatchOptions {
	readonly ignored?: readonly IgnoredPath[];
	readonly shallow?: readonly string[];
	readonly reportsUnreadable?: readonly string[];
}

export interface Watcher {
	readonly _serviceBrand: undefined;

	readonly onDidChangeFile: Event<readonly FileChange[]>;

	watch(paths: readonly string[], options?: WatchOptions): Promise<void>;
	stop(): Promise<void>;
}

export const Watcher = createDecorator<Watcher>("watcher");

function isBeyondShallow(
	target: string,
	paths: readonly string[],
	shallow: readonly string[]
): boolean {
	const posixTarget = toPosix(target);
	if (paths.some((entry) => containsPath(toPosix(entry), posixTarget)))
		return false;
	return shallow.some((dir) => {
		const posixDir = toPosix(dir);
		return (
			containsPath(posixDir, posixTarget) &&
			posixTarget !== posixDir &&
			path.posix.dirname(posixTarget) !== posixDir
		);
	});
}

function isIgnored(target: string, ignored: readonly IgnoredPath[]): boolean {
	const posixTarget = toPosix(target);
	return ignored.some((entry) => {
		if (entry instanceof RegExp) return entry.test(posixTarget);
		return containsPath(toPosix(entry), posixTarget);
	});
}

export class WatchFilter {
	private readonly paths: readonly string[];
	private readonly shallow: readonly string[];
	private readonly ignored: readonly IgnoredPath[];

	constructor(paths: readonly string[], options: WatchOptions) {
		this.paths = paths.map(toPosix);
		this.shallow = (options.shallow ?? []).map(toPosix);
		this.ignored = options.ignored ?? [];
	}

	skips(target: string): boolean {
		return (
			isIgnored(target, this.ignored) ||
			isBeyondShallow(target, this.paths, this.shallow)
		);
	}

	reports(target: string): boolean {
		const posixTarget = toPosix(target);
		return (
			[...this.paths, ...this.shallow].some((watched) =>
				containsPath(watched, posixTarget)
			) && !this.skips(posixTarget)
		);
	}
}
