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

	readonly onDidChangeFile: Event<FileChange[]>;

	/** Replaces what was watched, in call order with `stop`; resolves once changes to `paths` are reported: a file's own, and everything under a directory. */
	watch(paths: readonly string[], options?: WatchOptions): Promise<void>;
	stop(): Promise<void>;
}

export const Watcher = createServiceIdentifier<Watcher>("watcher");

/** Whether a watch leaves `target` out: it lies below a subfolder of a `shallow` directory, that subfolder isn't itself `shallow`, and no `paths` entry reaches it. */
export function isBeyondShallow(
	target: string,
	paths: readonly string[],
	shallow: readonly string[]
): boolean {
	const posixTarget = toPosix(target);
	if (paths.some((entry) => containsPosix(toPosix(entry), posixTarget)))
		return false;
	const posixShallow = shallow.map(toPosix);
	return (
		posixShallow.some((dir) => containsPosix(dir, posixTarget)) &&
		!posixShallow.some(
			(dir) =>
				posixTarget === dir || path.posix.dirname(posixTarget) === dir
		)
	);
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
