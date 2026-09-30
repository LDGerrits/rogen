import { toPosix } from "../../base/path.js";
import { Event } from "../../base/event.js";
import { FileChange } from "../fs/file-events.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface WatchRequest {
	readonly path: string;
	readonly recursive: boolean;
}

export type IgnoredPath = string | RegExp;

export interface WatchOptions {
	/** Paths to skip; a directory skips everything under it, and a pattern matches whole paths. */
	readonly ignored?: readonly IgnoredPath[];
}

export interface Watcher {
	readonly _serviceBrand: undefined;

	readonly onDidChangeFile: Event<FileChange[]>;
	readonly onDidError: Event<Error>;

	/** Resolves once changes under `requests` are being reported. */
	watch(requests: WatchRequest[], options?: WatchOptions): Promise<void>;
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
		const posixEntry = toPosix(entry);
		return (
			posixTarget === posixEntry ||
			posixTarget.startsWith(`${posixEntry}/`)
		);
	});
}
