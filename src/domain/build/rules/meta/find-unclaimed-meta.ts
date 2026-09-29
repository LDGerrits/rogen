import path from "path";
import { joinPosix, stemOf } from "../../../../base/path.js";
import {
	FileType,
	isDirectoryType,
	isFileType,
} from "../../../../platform/fs/file-system-service.js";
import { IndexReader } from "../../../../platform/fs/index-service.js";
import {
	rojoDataName,
	rojoMetaName,
} from "../../../rojo/rojo-assigned-name.js";
import {
	INIT_META_FILE,
	META_FILE_SUFFIX,
	classifyFile,
} from "../../../rojo/rojo-files.js";
import { ScannedRoot } from "../../model/scanned.js";

export interface UnclaimedMeta {
	/** Absolute, POSIX-style. */
	readonly path: string;
	readonly hint?: string;
}

/** Meta no sibling on disk claims under Rojo's naming rule; pruned and excluded siblings still claim theirs. */
export function findUnclaimedMeta(
	index: IndexReader,
	roots: readonly ScannedRoot[]
): UnclaimedMeta[] {
	return roots.flatMap((root) =>
		root.metaFiles.flatMap((metaFile) => {
			const fileName = path.posix.basename(metaFile);
			if (fileName === INIT_META_FILE) return [];
			const listing =
				index.getEntries(
					path.join(root.rootDir, path.posix.dirname(metaFile))
				) ?? new Map<string, FileType>();
			const siblings = [...listing]
				.filter(([, type]) => isFileType(type))
				.map(([sibling]) => sibling);
			const name = fileName.slice(0, -META_FILE_SUFFIX.length);
			if (siblings.some((file) => rojoMetaName(file) === name)) return [];

			const folder = listing.get(name);
			return [
				{
					path: joinPosix(root.rootDir, metaFile),
					hint: hintFor(
						name,
						siblings,
						folder !== undefined && isDirectoryType(folder)
					),
				},
			];
		})
	);
}

function hintFor(
	name: string,
	siblings: readonly string[],
	isFolder: boolean
): string | undefined {
	if (isFolder) return `a folder's meta is ${name}/init${META_FILE_SUFFIX}`;
	for (const file of siblings) {
		if (stemOf(file) !== name) continue;
		const metaName = rojoMetaName(file);
		if (metaName) return `Rojo reads ${metaName}${META_FILE_SUFFIX}`;
	}
	const withoutMeta = siblings.find(
		(file) =>
			rojoMetaName(file) === undefined &&
			classifyFile(file) !== undefined &&
			[stemOf(file), rojoDataName(file)].includes(name)
	);
	return withoutMeta ? `${withoutMeta} takes no meta` : undefined;
}
