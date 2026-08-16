import { Event } from "../../base/event.js";
import { FileChange } from "../fs/file-events.js";

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
