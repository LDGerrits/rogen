import { containsPosix, toPosix } from "../../base/path.js";
import { Event } from "../../base/event.js";
import { FileChange } from "../fs/file-changes.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export type IgnoredPath = string | RegExp;

export interface WatchOptions {
	/** Paths to skip; a directory skips everything under it, and a pattern matches whole paths. */
	readonly ignored?: readonly IgnoredPath[];
}

export interface Watcher {
	readonly _serviceBrand: undefined;

	readonly onDidChangeFile: Event<FileChange[]>;

	/** Replaces whatever was being watched, and resolves once changes to `paths` are being reported: a file's own, and everything under a directory. Watches and stops take effect in the order they're called. */
	watch(paths: readonly string[], options?: WatchOptions): Promise<void>;
	stop(): Promise<void>;
}

export const Watcher = createServiceIdentifier<Watcher>("watcher");

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
