import path from "path";
import { ancestors, isInside, toPosix } from "../../../../base/path.js";
import { rojoFileName } from "../../../rojo/rojo-assigned-name.js";
import { instanceKey } from "../../../rojo/rojo-tree.js";
import { RoutedFile } from "../../model/routed.js";
import { ScannedEntry } from "../../model/scanned.js";

interface PlacedEntry {
	readonly file: RoutedFile;
	readonly source: string;
	readonly rojoName: string;
}

function placeEntry(file: RoutedFile): PlacedEntry {
	const { entry } = file;
	return {
		file,
		source: entry.source,
		rojoName: rojoNameOf(entry),
	};
}

/** The name Rojo gives the entry when it enumerates the directory itself. */
function rojoNameOf(entry: ScannedEntry): string {
	const name = path.posix.basename(entry.relativePath);
	return entry.kind === "init-folder" ? name : rojoFileName(entry.kind, name);
}

/**
 * Directories whose every file on disk is placed under its Rojo name, mapped
 * to the instance path the directory becomes. Only the outermost of nested
 * candidates is kept, and only a directory that names its own node: Rojo would
 * apply a routing, tag or invisible folder's `init.meta.json` to its parent.
 */
export function collapsibleDirs(
	files: readonly RoutedFile[],
	leftOut: readonly string[],
	isReserved: (instancePath: readonly string[]) => boolean
): Map<string, readonly string[]> {
	const placed = files.map(placeEntry);
	const claims = new Map<string, number>();
	const entriesByDir = new Map<string, PlacedEntry[]>();
	const namedDirs = new Set<string>();
	for (const entry of placed) {
		const { instancePath, folderNodes, entry: scanned } = entry.file;
		for (let length = 1; length <= instancePath.length; length++)
			increment(claims, instanceKey(instancePath.slice(0, length)));

		const rootDir = toPosix(scanned.rootDir);
		for (const { dir } of folderNodes)
			namedDirs.add(path.posix.join(rootDir, dir));
		for (const dir of ancestors(entry.source)) {
			if (!isInside(dir, rootDir)) break;
			const inDir = entriesByDir.get(dir);
			if (inDir) inDir.push(entry);
			else entriesByDir.set(dir, [entry]);
		}
	}

	const blocked = new Set<string>();
	for (const source of leftOut)
		for (const dir of ancestors(source)) {
			if (blocked.has(dir)) break;
			blocked.add(dir);
		}

	const collapsed = new Map<string, readonly string[]>();
	const outermostFirst = [...entriesByDir.keys()].sort(
		(a, b) => depthOf(a) - depthOf(b)
	);
	for (const dir of outermostFirst) {
		if (
			blocked.has(dir) ||
			!namedDirs.has(dir) ||
			isCollapsed(dir, collapsed)
		)
			continue;
		const entries = entriesByDir.get(dir) as PlacedEntry[];
		const instancePath = instancePathOf(dir, entries);
		if (
			instancePath &&
			!isReserved(instancePath) &&
			claims.get(instanceKey(instancePath)) === entries.length
		)
			collapsed.set(dir, instancePath);
	}
	return collapsed;
}

/** The instance the directory becomes, if every entry sits where Rojo would put it. Never a service itself. */
function instancePathOf(
	dir: string,
	entries: readonly PlacedEntry[]
): readonly string[] | undefined {
	let base: readonly string[] | undefined;
	for (const { source, rojoName, file } of entries) {
		const below = path.posix.relative(dir, source).split("/");
		const expected = [...below.slice(0, -1), rojoName];
		const head = file.instancePath.slice(
			0,
			file.instancePath.length - expected.length
		);
		const tail = file.instancePath.slice(head.length);
		if (
			head.length < 2 ||
			tail.some((segment, index) => segment !== expected[index])
		)
			return undefined;
		if (base && instanceKey(base) !== instanceKey(head)) return undefined;
		base = head;
	}
	return base;
}

export function isCollapsed(
	source: string,
	collapsed: ReadonlyMap<string, readonly string[]>
): boolean {
	for (const dir of ancestors(source)) if (collapsed.has(dir)) return true;
	return false;
}

function depthOf(dir: string): number {
	return dir.split("/").length;
}

function increment(counts: Map<string, number>, key: string): void {
	counts.set(key, (counts.get(key) ?? 0) + 1);
}
