import path from "path";
import { isInside, toPosix } from "../../base/path.js";
import { FileChangeType } from "../../platform/fs/file-events.js";
import { FileType } from "../../platform/fs/file-system-service.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { rojoAssignedName, rojoModelName } from "../rojo/rojo-assigned-name.js";
import { TagResult } from "./apply-tags.js";
import { ScannedRoot, classifyFile } from "./root-scanner.js";
import { RouteMatch, RouteResult, RoutedFile } from "./route-files.js";

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
	readonly tags: readonly string[];
}

export interface PrunedLocation extends Located {
	readonly status: "pruned";
	readonly tag: string;
}

export interface ReplacedLocation extends Located {
	readonly status: "replaced";
	readonly by: string;
}

export interface UnplacedLocation extends Located {
	/** `ignored` exists but isn't an instance; `missing` doesn't exist and couldn't be one. */
	readonly status:
		"unrouted" | "excluded" | "skipped" | "outside" | "ignored" | "missing";
}

/** Where a path lands in the tree, or why it lands nowhere. */
export type FileLocation =
	PlacedLocation | PrunedLocation | ReplacedLocation | UnplacedLocation;

export interface Placement {
	readonly roots: readonly ScannedRoot[];
	readonly routing: RouteResult;
	readonly tagging: TagResult;
}

/** Adds each path that doesn't exist yet, and names a source file, to the index as that file. */
export function addUnwrittenFiles(
	index: IndexService,
	rootDirs: readonly string[],
	paths: readonly string[]
): void {
	for (const target of paths) {
		const rootDir = rootDirs.find((dir) => isInside(target, dir));
		if (!rootDir || !classifyFile(path.basename(target))) continue;
		if (index.getEntryType(path.dirname(target), path.basename(target)))
			continue;

		const missing: string[] = [];
		for (
			let dir = path.dirname(target);
			dir !== rootDir &&
			!index.getEntryType(path.dirname(dir), path.basename(dir));
			dir = path.dirname(dir)
		)
			missing.unshift(dir);
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

/** Every scanned path's location, or only those `paths` name, with a directory standing for what's inside it. */
export function locate(
	index: IndexService,
	placement: Placement,
	tags: Readonly<Record<string, boolean>>,
	paths?: readonly string[]
): FileLocation[] {
	const all = locateScanned(placement, tags);
	if (!paths) return [...all.values()].sort(bySource);

	const found = new Map<string, FileLocation>();
	for (const target of paths.map(toPosix))
		for (const location of locatePath(index, placement.roots, all, target))
			found.set(location.source, location);
	return [...found.values()];
}

function locateScanned(
	{ roots, routing, tagging }: Placement,
	tags: Readonly<Record<string, boolean>>
): Map<string, FileLocation> {
	const all = new Map<string, FileLocation>();
	const add = (location: FileLocation) => all.set(location.source, location);

	for (const root of roots) {
		for (const excluded of root.excluded)
			add({ status: "excluded", source: join(root.rootDir, excluded) });
		for (const link of root.skippedLinks)
			add({ status: "skipped", source: join(root.rootDir, link) });
	}
	for (const source of routing.unrouted) add({ status: "unrouted", source });

	const routed = new Map(
		routing.routed.map((file) => [sourceOf(file), file])
	);
	for (const source of tagging.pruned) {
		const file = routed.get(source) as RoutedFile;
		const dormant = file.tags.find(({ tag }) => !tags[tag]);
		add({ status: "pruned", source, tag: dormant?.tag ?? "" });
	}

	const winners = new Map(
		tagging.files.map((file) => [instanceKey(file), file])
	);
	for (const source of tagging.superseded) {
		const file = routed.get(source) as RoutedFile;
		const winner = winners.get(instanceKey(file)) as RoutedFile;
		add({ status: "replaced", source, by: sourceOf(winner) });
	}

	for (const file of tagging.files)
		add({
			status: "placed",
			source: sourceOf(file),
			instancePath: file.instancePath,
			route: file.route,
			routeMatch: file.routeMatch,
			tags: file.tags.map(({ tag }) => tag),
		});
	return all;
}

function locatePath(
	index: IndexService,
	roots: readonly ScannedRoot[],
	all: ReadonlyMap<string, FileLocation>,
	target: string
): FileLocation[] {
	const exact = all.get(target);
	if (exact) return [exact];
	const inRoot = (rootDir: string) =>
		target === rootDir || isInside(target, rootDir);
	if (!roots.some((root) => inRoot(toPosix(root.rootDir))))
		return [{ status: "outside", source: target }];

	for (
		let dir = path.posix.dirname(target);
		;
		dir = path.posix.dirname(dir)
	) {
		const enclosing = all.get(dir);
		if (enclosing) return [within(enclosing, target, dir)];
		if (path.posix.dirname(dir) === dir) break;
	}

	if (index.getEntries(target))
		return [...all.values()]
			.filter(({ source }) => source.startsWith(`${target}/`))
			.sort(bySource);
	const exists = index.getEntryType(
		path.posix.dirname(target),
		path.posix.basename(target)
	);
	return [{ status: exists ? "ignored" : "missing", source: target }];
}

/** A path inside an init folder, excluded directory or skipped link shares its fate. */
function within(
	enclosing: FileLocation,
	target: string,
	dir: string
): FileLocation {
	if (enclosing.status !== "placed")
		return { ...enclosing, source: target } as FileLocation;
	const below = path.posix.relative(dir, target).split("/");
	const name = below.pop() as string;
	const extension = path.posix.extname(name);
	const stem = name.slice(0, name.length - extension.length);
	const kind = classifyFile(name);
	if (!kind) return { status: "ignored", source: target };
	const instanceName =
		kind === "script"
			? rojoAssignedName(stem)
			: kind === "data"
				? rojoModelName(stem)
				: stem;
	const isInit = below.length === 0 && /^(init|index)$/i.test(instanceName);
	return {
		...enclosing,
		source: target,
		instancePath: isInit
			? enclosing.instancePath
			: [...enclosing.instancePath, ...below, instanceName],
	};
}

function join(rootDir: string, relativePath: string): string {
	return toPosix(path.join(rootDir, relativePath));
}

function sourceOf(file: RoutedFile): string {
	return join(file.entry.rootDir, file.entry.relativePath);
}

function instanceKey(file: RoutedFile): string {
	return file.instancePath.join("/");
}

function bySource(a: FileLocation, b: FileLocation): number {
	return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
}
