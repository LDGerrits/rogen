import path from "path";
import { compareStrings } from "../../../base/collection.js";
import { ancestors, isInside, toPosix } from "../../../base/path.js";
import { ok } from "../../../base/result.js";
import { rojoFileName } from "../../rojo/rojo-assigned-name.js";
import { RojoProject } from "../../rojo/rojo-project.js";
import { RojoTree, instanceKey } from "../../rojo/rojo-tree.js";
import { AssemblyStage, RoutedFile, ScannedEntry } from "../build-record.js";
import { syncPath } from "../sync-path.js";
import { generatedContainer, templateGlobs } from "../template.js";

interface PlacedEntry {
	readonly file: RoutedFile;
	readonly source: string;
	readonly rojoName: string;
}

const DECLARATION_FILE = /\.d\.ts$/i;

/** Merges the placed files into the template, collapsing a directory into one `$path` where Rojo would see the same files. */
export const assembleTree: AssemblyStage = (build) => {
	const { config, layout, template } = build;
	const project = new RojoProject(template.getTree(), generatedContainer);

	const placed = build.files.map(placeEntry);
	const leftOut = [...build.leftOut].filter(
		([source]) => !DECLARATION_FILE.test(source)
	);
	// A replaced file may share the winner's emitted path, and the template may mount a displaced one.
	const ignored = leftOut
		.filter(
			([, why]) => why.status !== "replaced" && why.status !== "displaced"
		)
		.map(([source]) => source)
		.sort(compareStrings);
	const collapsed = collapsibleDirs(
		placed,
		leftOut.map(([source]) => source),
		(instancePath) => template.getNode(instancePath) !== undefined
	);

	for (const [dir, instancePath] of collapsed)
		project.insertNode(instancePath, { $path: syncPath(dir, layout) });
	for (const entry of placed) {
		if (isCollapsed(entry.source, collapsed)) continue;
		project.insertNode(entry.file.instancePath, {
			$path: syncPath(entry.source, layout),
		});
	}

	const globIgnorePaths = [
		...new Set([
			...templateGlobs(config, layout.projectDir),
			...ignored.map((source) => syncPath(source, layout).optional),
		]),
	];
	const tree: RojoTree = {
		...config.template?.project,
		name: config.name,
		tree: project.getTree().tree,
	};
	if (globIgnorePaths.length > 0) tree.globIgnorePaths = globIgnorePaths;
	else delete tree.globIgnorePaths;

	return ok({ ...build, tree, collapsed });
};

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
function collapsibleDirs(
	placed: readonly PlacedEntry[],
	leftOut: readonly string[],
	isReserved: (instancePath: readonly string[]) => boolean
): Map<string, readonly string[]> {
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
