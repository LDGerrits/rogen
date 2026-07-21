import { Event } from "../../base/event.js";
import { FileType } from "../fs/file-system-service.js";

export enum FileChangeType {
	ADDED = 1,
	DELETED = 2,
	UPDATED = 3,
}

export interface FileChange {
	readonly type: FileChangeType;
	readonly path: string;
	readonly fileType: FileType;
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

/**
 * Resolves redundant file changes.
 */
export function normalizeFileChanges(changes: FileChange[]): FileChange[] {
	const map = new Map<string, FileChange>();

	for (const change of changes) {
		const existing = map.get(change.path);

		if (!existing) {
			map.set(change.path, change);
			continue;
		}

		if (
			existing.type === FileChangeType.ADDED &&
			change.type === FileChangeType.DELETED
		) {
			map.delete(change.path);
		} else if (change.type === FileChangeType.DELETED) {
			map.set(change.path, { ...change, type: FileChangeType.DELETED });
		} else if (
			existing.type === FileChangeType.ADDED &&
			change.type === FileChangeType.UPDATED
		) {
			map.set(change.path, { ...change, type: FileChangeType.ADDED });
		} else {
			map.set(change.path, change);
		}
	}

	return Array.from(map.values());
}
