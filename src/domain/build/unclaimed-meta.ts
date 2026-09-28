import path from "path";
import { toPosix } from "../../base/path.js";
import {
	rojoAssignedName,
	stripRojoDataSuffix,
} from "../rojo/rojo-assigned-name.js";
import { classifyFile, ScannedRoot } from "./root-scanner.js";

const META_SUFFIX = ".meta.json";
const FOLDER_META = "init";

/**
 * Every `.meta.json` other than `init.meta.json` that no sibling claims under
 * Rojo's naming rule, as its absolute POSIX path followed by the likely fix.
 * Pruned and excluded siblings still claim theirs.
 */
export function findUnclaimedMeta(roots: readonly ScannedRoot[]): string[] {
	return roots.flatMap((root) => {
		const siblings = siblingsByDir(root);
		const dirs = dirsOf(root);
		return root.metaFiles.flatMap((metaFile) => {
			const dir = parentOf(metaFile);
			const name = path.posix
				.basename(metaFile)
				.slice(0, -META_SUFFIX.length);
			if (name === FOLDER_META) return [];

			const inDir = siblings.get(dir) ?? [];
			if (inDir.some((file) => metaNameOf(file) === name)) return [];

			const hint = hintFor(name, inDir, dirs.has(join(dir, name)));
			const shown = toPosix(path.join(root.rootDir, metaFile));
			return [hint ? `${shown} (${hint})` : shown];
		});
	});
}

function hintFor(
	name: string,
	siblings: readonly string[],
	isFolder: boolean
): string | undefined {
	if (isFolder) return `a folder's meta is ${name}/init${META_SUFFIX}`;
	for (const file of siblings) {
		if (stemOf(file) !== name) continue;
		const metaName = metaNameOf(file);
		if (metaName) return `Rojo reads ${metaName}${META_SUFFIX}`;
	}
	const withoutMeta = siblings.find(
		(file) =>
			metaNameOf(file) === undefined &&
			classifyFile(file) !== undefined &&
			[stemOf(file), stripRojoDataSuffix(stemOf(file))].includes(name)
	);
	return withoutMeta ? `${withoutMeta} takes no meta` : undefined;
}

/** The meta name Rojo reads for `fileName`, or none for a file that takes no meta. */
function metaNameOf(fileName: string): string | undefined {
	const kind = classifyFile(fileName);
	const stem = stemOf(fileName);
	if (kind === "script") return rojoAssignedName(stem);
	if (kind === "data" && stripRojoDataSuffix(stem) === stem) return stem;
	return undefined;
}

/** File names per directory, relative to the root dir, counting excluded paths too. */
function siblingsByDir(root: ScannedRoot): Map<string, string[]> {
	const byDir = new Map<string, string[]>();
	const files = [
		...root.entries.flatMap((entry) =>
			entry.kind === "init-folder" ? [] : [entry.relativePath]
		),
		...root.excluded,
	];
	for (const file of files) {
		const dir = parentOf(file);
		byDir.set(dir, [...(byDir.get(dir) ?? []), path.posix.basename(file)]);
	}
	return byDir;
}

/** Every directory the scan saw a path in, relative to the root dir. */
function dirsOf(root: ScannedRoot): Set<string> {
	const dirs = new Set<string>();
	const paths = [
		...root.entries.map((entry) =>
			entry.kind === "init-folder"
				? `${entry.relativePath}/${entry.initFile}`
				: entry.relativePath
		),
		...root.markers,
		...root.metaFiles,
		...root.excluded,
		...root.skippedLinks,
	];
	for (const relativePath of paths)
		for (let dir = parentOf(relativePath); dir; dir = parentOf(dir))
			dirs.add(dir);
	return dirs;
}

function parentOf(relativePath: string): string {
	const dir = path.posix.dirname(relativePath);
	return dir === "." ? "" : dir;
}

function join(dir: string, name: string): string {
	return dir ? `${dir}/${name}` : name;
}

function stemOf(fileName: string): string {
	return fileName.slice(0, fileName.length - path.extname(fileName).length);
}
