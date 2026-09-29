import path from "path";
import { joinPosix, stemOf } from "../../../../base/path.js";
import { ok } from "../../../../base/result.js";
import { stripRojoDataSuffix } from "../../../rojo/rojo-assigned-name.js";
import { RojoFileKind } from "../../../rojo/rojo-files.js";
import {
	EntryRead,
	FolderRead,
	MarkerRead,
	PlacementStage,
	ScannedEntry,
} from "../../build-record.js";
import {
	declaredKeysOf,
	matchKeyIgnoringCase,
	matchMarkerKey,
	matchSuffixKeys,
	readFolderName,
} from "../../keys/declared-key.js";

/** Reads every folder, marker and suffix against the declared keys, once, for the stages and rules after it. */
export const readPaths: PlacementStage = (build) => {
	const { routeKeys, tagKeys, all } = declaredKeysOf(build.config);
	const folders = new Map<string, FolderRead>();
	const markers = new Map<string, MarkerRead>();
	const entries = new Map<string, EntryRead>();

	const folderAt = (rootDir: string, dir: string): FolderRead => {
		const key = joinPosix(rootDir, dir);
		let read = folders.get(key);
		if (!read) {
			const segment = path.posix.basename(dir);
			const reading = readFolderName(segment, routeKeys, tagKeys);
			read = {
				...reading,
				segment,
				dir,
				nearMissKey:
					reading.kind === "plain"
						? matchKeyIgnoringCase(reading.name, all)
						: undefined,
			};
			folders.set(key, read);
		}
		return read;
	};

	const readFoldersAbove = (rootDir: string, relativePath: string) => {
		const above: FolderRead[] = [];
		let dir = "";
		for (const segment of relativePath.split("/").slice(0, -1)) {
			dir = dir ? `${dir}/${segment}` : segment;
			above.push(folderAt(rootDir, dir));
		}
		return above;
	};

	for (const root of build.roots) {
		for (const marker of root.markers) {
			readFoldersAbove(root.rootDir, marker);
			const name = path.posix.basename(marker);
			markers.set(joinPosix(root.rootDir, marker), {
				key: matchMarkerKey(name, all),
				nearMissKey: matchKeyIgnoringCase(name.slice(1), all),
			});
		}
		for (const metaFile of root.metaFiles)
			readFoldersAbove(root.rootDir, metaFile);
		for (const entry of root.entries) {
			const { fileName, kind, stem } = suffixedNameOf(entry);
			entries.set(entry.source, {
				folders: readFoldersAbove(root.rootDir, entry.relativePath),
				fileName,
				kind,
				stem,
				match: matchSuffixKeys(stem, all),
			});
		}
	}
	return ok({ ...build, readings: { folders, markers, entries } });
};

function suffixedNameOf(entry: ScannedEntry): {
	readonly fileName: string;
	readonly kind: RojoFileKind;
	readonly stem: string;
} {
	const isInitFolder = entry.kind === "init-folder";
	const fileName = isInitFolder
		? entry.initFile
		: path.posix.basename(entry.relativePath);
	const kind: RojoFileKind = isInitFolder ? "script" : entry.kind;
	const stem = stemOf(fileName);
	return {
		fileName,
		kind,
		stem: kind === "data" ? stripRojoDataSuffix(stem) : stem,
	};
}
