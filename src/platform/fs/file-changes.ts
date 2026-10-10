import { FileType } from "./file-system-service.js";

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

/** `changes` without the redundant ones: an add then a delete cancel, and an add then an update stays an add. */
export function normalizeFileChanges(
	changes: readonly FileChange[]
): FileChange[] {
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
