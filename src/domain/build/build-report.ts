import path from "path";
import { compareStrings } from "../../base/collection.js";
import { ancestors, contains, isInside, toPosix } from "../../base/path.js";
import {
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import {
	classifyFile,
	isInitScript,
	rojoFileName,
} from "../rojo/rojo-files.js";
import { BuildSummary, FileLocation } from "./build-service.js";
import {
	LeftOut,
	PlacedBuild,
	ScannedRoot,
	TagMatch,
} from "./build-record.js";

/** What a build did, counted for the summary. */
export function summarizeBuild({
	config,
	roots,
	files,
	leftOut,
}: PlacedBuild): BuildSummary {
	const countOf = (
		status: LeftOut["status"],
		paths: Iterable<LeftOut> = leftOut.values()
	) => [...paths].filter((why) => why.status === status).length;
	const carrying = (tag: string, tagSets: readonly (readonly TagMatch[])[]) =>
		tagSets.filter((tags) => tags.some((match) => match.tag === tag))
			.length;
	const placedTags = files.map((file) => file.tags);
	const prunedTags = [...leftOut.values()].flatMap((why) =>
		why.status === "pruned" ? [why.tags] : []
	);
	return {
		roots: roots.map((root) => ({
			rootDir: root.rootDir,
			files: root.entries.length,
			excluded: countOf("excluded", root.leftOut.values()),
			skippedLinks: countOf("skipped", root.leftOut.values()),
		})),
		routes: Object.entries(config.routes).map(([key, target]) => ({
			key,
			target,
			files: files.filter((file) => file.route === key).length,
		})),
		// Every routed file with an off tag was pruned, so off tags count those.
		tags: Object.entries(config.tags).map(([tag, on]) => ({
			tag,
			on,
			files: carrying(tag, on ? placedTags : prunedTags),
		})),
		unrouted: countOf("unrouted"),
		superseded: countOf("replaced"),
		displaced: countOf("displaced"),
	};
}

/** Every scanned path's location, or only those `paths` name, where a directory stands for what's in it. */
export function locateFiles(
	build: PlacedBuild,
	paths?: readonly string[]
): FileLocation[] {
	const { index, roots } = build;
	const all = locateScanned(build);
	if (!paths) return [...all.values()].sort(bySource);

	const found = new Map<string, FileLocation>();
	for (const target of paths.map(toPosix))
		for (const location of locatePath(index, roots, all, target))
			found.set(location.source, location);
	return [...found.values()];
}

function locateScanned({
	index,
	files,
	leftOut,
}: PlacedBuild): Map<string, FileLocation> {
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
	index: IndexReader,
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
	index: IndexReader,
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

/** `index` with the source files that don't exist yet, and their folders, added on top; `index` itself is untouched. */
export function withPlannedFiles(
	index: IndexReader,
	rootDirs: readonly string[],
	paths: readonly string[]
): IndexReader {
	const added = new Map<string, Map<string, FileType>>();
	const addedTo = (dir: string) => added.get(toPosix(dir));
	const has = (dir: string, name: string) =>
		index.hasEntry(dir, name) || addedTo(dir)?.has(name) === true;
	const add = (entry: string, type: FileType) => {
		const dir = toPosix(path.dirname(entry));
		const entries = added.get(dir) ?? new Map<string, FileType>();
		added.set(dir, entries.set(path.basename(entry), type));
	};

	for (const target of paths) {
		const rootDir = rootDirs.find((dir) => isInside(target, dir));
		if (!rootDir || !classifyFile(path.basename(target))) continue;
		if (has(path.dirname(target), path.basename(target))) continue;

		add(target, FileType.File);
		for (const dir of ancestors(target)) {
			if (dir === rootDir || has(path.dirname(dir), path.basename(dir)))
				break;
			add(dir, FileType.Directory);
		}
	}

	return {
		getEntries: (dir) => {
			const base = index.getEntries(dir);
			const extra = addedTo(dir);
			return extra ? new Map([...(base ?? []), ...extra]) : base;
		},
		hasEntry: has,
		getEntryType: (dir, name) =>
			index.getEntryType(dir, name) ?? addedTo(dir)?.get(name),
	};
}
