import path from "path";
import { compareStrings } from "../../base/collection.js";
import { ancestors, contains, isInside, toPosix } from "../../base/path.js";
import { FileChangeType } from "../../platform/fs/file-events.js";
import {
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { rojoFileName } from "../rojo/rojo-assigned-name.js";
import { classifyFile, isInitScript } from "../rojo/rojo-files.js";
import { ScannedRoot } from "./root-scanner.js";
import { LeftOut } from "./left-out.js";
import { Placement } from "./place-files.js";
import { RouteMatch, TagMatch } from "./route-files.js";

interface Located {
	/** An absolute POSIX path. */
	readonly source: string;
}

export interface PlacedLocation extends Located {
	readonly status: "placed";
	readonly instancePath: readonly string[];
	readonly route: string;
	readonly routeMatch: RouteMatch;
	/** The active tags the file carries. */
	readonly tags: readonly TagMatch[];
}

export interface UnplacedLocation extends Located {
	/** `ignored` exists but isn't an instance. */
	readonly status: "outside" | "ignored" | "missing" | "empty";
}

/** Where a path lands in the tree, or why it lands nowhere. */
export type FileLocation =
	PlacedLocation | (LeftOut & Located) | UnplacedLocation;

/** Adds each path that names a source file and doesn't exist yet to `index`, with the folders it needs. */
export function addPlannedFiles(
	index: IndexService,
	rootDirs: readonly string[],
	paths: readonly string[]
): void {
	for (const target of paths) {
		const rootDir = rootDirs.find((dir) => isInside(target, dir));
		if (!rootDir || !classifyFile(path.basename(target))) continue;
		if (index.hasEntry(path.dirname(target), path.basename(target)))
			continue;

		const missing: string[] = [];
		for (const dir of ancestors(target)) {
			if (
				dir === rootDir ||
				index.hasEntry(path.dirname(dir), path.basename(dir))
			)
				break;
			missing.unshift(dir);
		}
		index.applyChanges([
			...missing.map((dir) => ({
				type: FileChangeType.ADDED,
				path: dir,
				fileType: FileType.Directory,
			})),
			{
				type: FileChangeType.ADDED,
				path: target,
				fileType: FileType.File,
			},
		]);
	}
}

/** Every scanned path's location, or only those `paths` name, where a directory stands for what's in it. */
export function locate(
	index: IndexService,
	placement: Placement,
	paths?: readonly string[]
): FileLocation[] {
	const all = locateScanned(index, placement);
	if (!paths) return [...all.values()].sort(bySource);

	const found = new Map<string, FileLocation>();
	for (const target of paths.map(toPosix))
		for (const location of locatePath(index, placement.roots, all, target))
			found.set(location.source, location);
	return [...found.values()];
}

function locateScanned(
	index: IndexService,
	{ files, leftOut }: Placement
): Map<string, FileLocation> {
	const all = new Map<string, FileLocation>();
	const add = (location: FileLocation) => all.set(location.source, location);

	for (const [source, why] of leftOut) add({ ...why, source });

	for (const file of files) {
		const folder = file.entry.source;
		const members =
			file.entry.kind === "init-folder"
				? membersOfInitFolder(index, folder, file.instancePath)
				: [{ source: folder, instancePath: file.instancePath }];
		for (const { source, instancePath } of members)
			add({
				status: "placed",
				source,
				instancePath,
				route: file.route,
				routeMatch: file.routeMatch,
				tags: file.tags,
			});
	}
	return all;
}

/** Rojo reads everything in an init folder as children of the folder's instance, and its init script as the folder itself. */
function membersOfInitFolder(
	index: IndexService,
	folder: string,
	folderInstance: readonly string[]
): { source: string; instancePath: readonly string[] }[] {
	const members: { source: string; instancePath: readonly string[] }[] = [];
	const visit = (dir: string, below: readonly string[]) => {
		const listing = [...(index.getEntries(dir) ?? [])].sort(([a], [b]) =>
			compareStrings(a, b)
		);
		for (const [name, type] of listing) {
			if (isDirectoryType(type)) {
				visit(`${dir}/${name}`, [...below, name]);
				continue;
			}
			const kind = classifyFile(name);
			if (!isFileType(type) || !kind) continue;
			members.push({
				source: `${dir}/${name}`,
				instancePath: [
					...folderInstance,
					...below,
					...(isInitScript(name) ? [] : [rojoFileName(kind, name)]),
				],
			});
		}
	};
	visit(folder, []);
	return members;
}

function locatePath(
	index: IndexService,
	roots: readonly ScannedRoot[],
	all: ReadonlyMap<string, FileLocation>,
	target: string
): FileLocation[] {
	const below = [...all.values()]
		.filter(({ source }) => source.startsWith(`${target}/`))
		.sort(bySource);
	const exact = all.get(target);
	if (exact) return [exact, ...below];
	if (below.length > 0) return below;

	if (!roots.some((root) => contains(toPosix(root.rootDir), target)))
		return [{ status: "outside", source: target }];

	for (const dir of ancestors(target)) {
		const enclosing = all.get(dir);
		if (enclosing) return [{ ...enclosing, source: target }];
	}

	if (index.getEntries(target)) return [{ status: "empty", source: target }];
	const exists = index.hasEntry(
		path.posix.dirname(target),
		path.posix.basename(target)
	);
	return [{ status: exists ? "ignored" : "missing", source: target }];
}

function bySource(a: FileLocation, b: FileLocation): number {
	return compareStrings(a.source, b.source);
}
