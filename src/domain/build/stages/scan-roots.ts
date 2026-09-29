import path from "path";
import { compareStrings } from "../../../base/collection.js";
import { isMatch } from "../../../base/glob.js";
import { joinPosix, toPosix } from "../../../base/path.js";
import { ok } from "../../../base/result.js";
import {
	FileType,
	isDirectoryType,
	isFileType,
} from "../../../platform/fs/file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import {
	INIT_META_FILE,
	classifyFile,
	isInitScript,
	isMetaFile,
} from "../../rojo/rojo-files.js";
import {
	PlacementStage,
	ScanLeftOut,
	ScannedEntry,
	ScannedRoot,
} from "../build-record.js";

/** Reads the root dirs from the index, in `rootDirs` order, which decides clashes between them. */
export const scanRoots: PlacementStage = (build) => {
	const roots = build.config.rootDirs.map(
		(rootDir) =>
			scanRoot(build.index, rootDir, build.config.exclude) ??
			emptyRoot(rootDir)
	);
	return ok({
		...build,
		roots,
		leftOut: new Map([
			...build.leftOut,
			...roots.flatMap((root) => [...root.leftOut]),
		]),
	});
};

function emptyRoot(rootDir: string): ScannedRoot {
	return {
		rootDir,
		exists: false,
		entries: [],
		markers: [],
		metaFiles: [],
		leftOut: new Map(),
	};
}

function scanRoot(
	index: IndexReader,
	rootDir: string,
	exclude: readonly string[]
): ScannedRoot | undefined {
	const entries: ScannedEntry[] = [];
	const markers: string[] = [];
	const metaFiles: string[] = [];
	const leftOut = new Map<string, ScanLeftOut>();

	const excludingGlob = (absolutePath: string) => {
		const posixPath = toPosix(absolutePath);
		return exclude.find((glob) => isMatch(posixPath, glob));
	};

	const visit = (dir: string): boolean => {
		const listing = index.getEntries(dir);
		if (!listing) return false;

		const relativeDir = toPosix(path.relative(rootDir, dir));
		const relativeTo = (name: string) =>
			relativeDir ? `${relativeDir}/${name}` : name;

		const kept: [string, FileType][] = [];
		for (const [name, type] of listing) {
			const glob = excludingGlob(path.join(dir, name));
			if (glob)
				leftOut.set(joinPosix(dir, name), {
					status: "excluded",
					pattern: glob,
				});
			else kept.push([name, type]);
		}

		const initFile = kept
			.filter(([name, type]) => isFileType(type) && isInitScript(name))
			.map(([name]) => name)
			.sort()[0];
		if (initFile && relativeDir) {
			if (kept.some(([name]) => name === INIT_META_FILE))
				metaFiles.push(relativeTo(INIT_META_FILE));
			entries.push({
				kind: "init-folder",
				rootDir,
				relativePath: relativeDir,
				source: joinPosix(rootDir, relativeDir),
				initFile,
			});
			return true;
		}

		const subdirs: string[] = [];
		for (const [name, type] of kept) {
			if (type === FileType.SymbolicLink) {
				leftOut.set(joinPosix(dir, name), { status: "skipped" });
			} else if (isDirectoryType(type)) {
				subdirs.push(path.join(dir, name));
			} else {
				// A key can't contain a dot, so a dot-file with a file type is never a marker.
				const kind = classifyFile(name);
				if (isMetaFile(name)) {
					metaFiles.push(relativeTo(name));
				} else if (kind) {
					entries.push({
						kind,
						rootDir,
						relativePath: relativeTo(name),
						source: joinPosix(dir, name),
					});
				} else if (name.startsWith(".")) {
					markers.push(relativeTo(name));
				}
			}
		}

		subdirs.forEach(visit);
		return true;
	};

	if (!visit(rootDir)) return undefined;

	return {
		rootDir,
		exists: true,
		entries: entries.sort(byRelativePath),
		markers: markers.sort(),
		metaFiles: metaFiles.sort(),
		leftOut,
	};
}

function byRelativePath(a: ScannedEntry, b: ScannedEntry): number {
	return compareStrings(a.relativePath, b.relativePath);
}
