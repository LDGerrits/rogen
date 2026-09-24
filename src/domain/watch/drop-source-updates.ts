import { FileChange, FileChangeType } from "../../platform/fs/file-events.js";

/** The tree is a function of the directory listing, so only `contentFiles` (configs, templates) matter when they are updated. */
export function dropSourceUpdates(
	changes: readonly FileChange[],
	contentFiles: ReadonlySet<string>
): FileChange[] {
	return changes.filter(
		(change) =>
			change.type !== FileChangeType.UPDATED ||
			contentFiles.has(change.path)
	);
}
