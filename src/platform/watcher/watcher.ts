import { Event } from "../../base/event.js";
import { FileChange } from "../fs/file-events.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface WatchRequest {
	readonly path: string;
	readonly recursive: boolean;
}

export interface WatchOptions {
	/** Paths to skip; a directory skips everything under it, and a pattern matches whole paths. */
	readonly ignored?: readonly (string | RegExp)[];
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
