import path from "path";
import { toPosix } from "../../base/path.js";
import {
	rojoAssignedName,
	stripRojoDataSuffix,
} from "../rojo/rojo-assigned-name.js";
import {
	INIT_META_FILE,
	META_FILE_SUFFIX,
	ScannedRoot,
	classifyFile,
} from "./root-scanner.js";

export interface UnclaimedMeta {
	/** Absolute, POSIX-style. */
	readonly path: string;
	readonly hint?: string;
}

/** Meta no sibling claims under Rojo's naming rule, pruned and excluded siblings included. */
export function findUnclaimedMeta(
	roots: readonly ScannedRoot[]
): UnclaimedMeta[] {
	return roots.flatMap((root) => {
		const siblings = siblingsByDir(root);
		const dirs = dirsOf(root);
		return root.metaFiles.flatMap((metaFile) => {
			const fileName = path.posix.basename(metaFile);
			if (fileName === INIT_META_FILE) return [];
			const dir = parentOf(metaFile);
			const name = fileName.slice(0, -META_FILE_SUFFIX.length);

			const inDir = siblings.get(dir) ?? [];
			if (inDir.some((file) => metaNameOf(file) === name)) return [];

			return [
				{
					path: toPosix(path.join(root.rootDir, metaFile)),
					hint: hintFor(name, inDir, dirs.has(childPath(dir, name))),
				},
			];
		});
	});
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

function childPath(dir: string, name: string): string {
	return dir ? `${dir}/${name}` : name;
}

function stemOf(fileName: string): string {
	return fileName.slice(0, fileName.length - path.extname(fileName).length);
}
