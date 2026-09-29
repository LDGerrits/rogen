import path from "path";
import { joinPosix, stemOf } from "../../../../base/path.js";
import {
	FileType,
	isDirectoryType,
	isFileType,
} from "../../../../platform/fs/file-system-service.js";
import { IndexReader } from "../../../../platform/fs/index-service.js";
import {
	rojoAssignedName,
	stripRojoDataSuffix,
} from "../../../rojo/rojo-assigned-name.js";
import {
	INIT_META_FILE,
	META_FILE_SUFFIX,
	classifyFile,
} from "../../../rojo/rojo-files.js";
import { BuildRule, ScannedRoot } from "../../build-record.js";
import { MetaDiagnostics, UnclaimedMeta } from "../../meta-diagnostics.js";

export const unclaimedMeta: BuildRule = ({ config, index, roots }) => {
	const unclaimed = findUnclaimedMeta(index, roots);
	return unclaimed.length > 0
		? [MetaDiagnostics.unclaimed({ resource: config.outFile }, unclaimed)]
		: [];
};

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
			if (siblings.some((file) => metaNameOf(file) === name)) return [];

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
		const metaName = metaNameOf(file);
		if (metaName) return `Rojo reads ${metaName}${META_FILE_SUFFIX}`;
	}
	const withoutMeta = siblings.find(
		(file) =>
			metaNameOf(file) === undefined &&
			classifyFile(file) !== undefined &&
			[stemOf(file), rojoDataName(file)].includes(name)
	);
	return withoutMeta ? `${withoutMeta} takes no meta` : undefined;
}

/** The `.meta.json` Rojo reads for `fileName`, or none for a file that takes no meta. */
export function metaFileFor(fileName: string): string | undefined {
	const name = metaNameOf(fileName);
	return name === undefined ? undefined : `${name}${META_FILE_SUFFIX}`;
}

/** The meta name Rojo reads for `fileName`, or none for a file that takes no meta. */
function metaNameOf(fileName: string): string | undefined {
	const kind = classifyFile(fileName);
	const stem = stemOf(fileName);
	if (kind === "script") return rojoAssignedName(stem);
	if (kind === "data" && rojoDataName(fileName) === stem) return stem;
	return undefined;
}

// Rojo only reads `.model` and `.project` as a suffix on `.json` files.
function rojoDataName(fileName: string): string {
	const stem = stemOf(fileName);
	return path.extname(fileName).toLowerCase() === ".json"
		? stripRojoDataSuffix(stem)
		: stem;
}
