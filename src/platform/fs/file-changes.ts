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

/** `changes` without the redundant ones: a path added and then deleted is as it was, and an add then an update stays an add. */
export function normalizeFileChanges(
	changes: readonly FileChange[]
): FileChange[] {
	const map = new Map<string, FileChange>();
	/** What the path first did, since only one that did not exist before may cancel out. */
	const first = new Map<string, FileChangeType>();

	for (const change of changes) {
		const existing = map.get(change.path);

		if (!existing) {
			map.set(change.path, change);
			first.set(change.path, change.type);
			continue;
		}

		if (
			first.get(change.path) === FileChangeType.ADDED &&
			change.type === FileChangeType.DELETED
		) {
			map.delete(change.path);
			first.delete(change.path);
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
