import path from "path";
import { containsPosix, toPosix } from "../../base/path.js";
import { Event } from "../../base/event.js";
import { FileChange } from "../fs/file-changes.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export type IgnoredPath = string | RegExp;

export interface WatchOptions {
	/** Paths to skip; a directory skips everything under it, and a pattern matches whole paths. */
	readonly ignored?: readonly IgnoredPath[];
	/** Directories to watch for their own entries only, unless `paths` also reaches a subfolder. */
	readonly shallow?: readonly string[];
}

export interface Watcher {
	readonly _serviceBrand: undefined;

	/** Changes as they come, normally one at a time; a consumer that wants them batched debounces them. */
	readonly onDidChangeFile: Event<readonly FileChange[]>;

	/** Replaces what was watched, in call order with `stop`; resolves once changes to `paths` are reported: a file's own, and everything under a directory. */
	watch(paths: readonly string[], options?: WatchOptions): Promise<void>;
	stop(): Promise<void>;
}

export const Watcher = createServiceIdentifier<Watcher>("watcher");

/** Whether a watch leaves `target` out: it lies below a subfolder of a `shallow` directory and no `paths` entry reaches it. */
export function isBeyondShallow(
	target: string,
	paths: readonly string[],
	shallow: readonly string[]
): boolean {
	const posixTarget = toPosix(target);
	if (paths.some((entry) => containsPosix(toPosix(entry), posixTarget)))
		return false;
	return shallow.some((dir) => {
		const posixDir = toPosix(dir);
		return (
			containsPosix(posixDir, posixTarget) &&
			posixTarget !== posixDir &&
			path.posix.dirname(posixTarget) !== posixDir
		);
	});
}

/** Whether `target` is one of `ignored`, or lies under one; a pattern matches the posix form of the whole path. */
export function isIgnored(
	target: string,
	ignored: readonly IgnoredPath[]
): boolean {
	const posixTarget = toPosix(target);
	return ignored.some((entry) => {
		if (entry instanceof RegExp) return entry.test(posixTarget);
		return containsPosix(toPosix(entry), posixTarget);
	});
}

/** What a watch of `paths` with `options` looks at, decided the same way by every watcher. */
export class WatchFilter {
	private readonly paths: readonly string[];
	private readonly shallow: readonly string[];
	private readonly ignored: readonly IgnoredPath[];

	constructor(paths: readonly string[], options: WatchOptions) {
		this.paths = paths.map(toPosix);
		this.shallow = (options.shallow ?? []).map(toPosix);
		this.ignored = options.ignored ?? [];
	}

	/** Whether the watch leaves `target` out, however far a walk has got: it is ignored, or lies beyond a shallow directory. */
	skips(target: string): boolean {
		return (
			isIgnored(target, this.ignored) ||
			isBeyondShallow(target, this.paths, this.shallow)
		);
	}

	/** Whether a change at `target` is reported: it lies in what is watched and the watch doesn't skip it. */
	reports(target: string): boolean {
		const posixTarget = toPosix(target);
		return (
			[...this.paths, ...this.shallow].some((watched) =>
				containsPosix(watched, posixTarget)
			) && !this.skips(posixTarget)
		);
	}
}
