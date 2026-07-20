import { Event } from "../../base/event.js";

export enum FileChangeType {
	ADDED = 1,
	DELETED = 2,
	UPDATED = 3,
}

export interface FileChange {
	readonly type: FileChangeType;
	readonly path: string;
}

export interface WatchRequest {
	readonly path: string;
	readonly recursive: boolean;
}

export interface Watcher {
	readonly onDidChangeFile: Event<FileChange[]>;
	readonly onDidError: Event<Error>;

	watch(requests: WatchRequest[]): Promise<void>;
	stop(): Promise<void>;
}
