import path from "path";
import { FileChange, FileChangeType } from "../../platform/fs/file-events.js";
import { INIT_META_FILE } from "../rojo/rojo-files.js";

/** The tree is a function of the directory listing and folder meta, so only `contentFiles` (configs, templates) and `init.meta.json` matter when they are updated. */
export function dropSourceUpdates(
	changes: readonly FileChange[],
	contentFiles: ReadonlySet<string>
): FileChange[] {
	return changes.filter(
		(change) =>
			change.type !== FileChangeType.UPDATED ||
			contentFiles.has(change.path) ||
			path.basename(change.path) === INIT_META_FILE
	);
}
