import path from "path";
import { contains, toNative } from "../../base/path.js";
import {
	GoneIntent,
	HoldIntent,
	Intent,
	MovedFile,
	Operation,
	sameBytes,
} from "./mirror-plan.js";
import { GITKEEP } from "./syncback-layout.js";

/** What retention reads of the project's folders, read before it runs. */
export interface Disk {
	/**
	 * The names in a folder, none when it can't be read, and undefined when
	 * it wasn't read, which keeps the folder.
	 */
	entriesOf(folder: string): readonly string[] | undefined;
	bytesOf(file: string): Uint8Array | undefined;
}

/** What the place and its mirror say about the project's folders. */
export interface PlaceView {
	/** Mirror paths the place still holds, and every folder above them. */
	readonly held: ReadonlySet<string>;
	/** Mirror paths of the project's files that were copied in. */
	readonly copied: ReadonlySet<string>;
	/** Each mirror folder copied from the project, with the folder it copies. */
	readonly folders: ReadonlyMap<string, string>;
	readonly sourcePaths: readonly string[];
	readonly compiledPath?: string;
	instanceAt(at: string): string;
}

export interface Retention {
	/** What the plan does, a `.gitkeep` aside. */
	readonly operations: readonly Operation[];
	/** The `.gitkeep`s that keep folders the place still holds. */
	readonly gitkeeps: readonly Operation[];
	/** Removals a hold kept for a file it names. */
	readonly kept: readonly GoneIntent[];
	/** Instances of compiled folders the place no longer holds. */
	readonly leftOut: readonly string[];
}

interface Pruning {
	readonly prunes: readonly Operation[];
	readonly keeps: ReadonlyMap<string, string>;
	readonly leftOut: readonly string[];
}

const isFilling = ({ kind }: Operation) =>
	kind === "write" || kind === "folder";

const isRemoving = ({ kind }: Operation) =>
	kind === "remove" || kind === "prune";

function operationOf(intent: Exclude<Intent, HoldIntent>): Operation {
	if (intent.kind !== "gone") return intent;
	const { folder, ...rest } = intent;
	return { ...rest, kind: folder ? "prune" : "remove" };
}

const isSame = (a: Operation, b: Operation) =>
	a.kind === b.kind &&
	a.file === b.file &&
	(a.kind !== "write" || (b.kind === "write" && sameBytes(a.bytes, b.bytes)));

function withoutRepeats(operations: readonly Operation[]): Operation[] {
	const seen: Operation[] = [];
	for (const operation of operations)
		if (!seen.some((other) => isSame(other, operation)))
			seen.push(operation);
	return seen;
}

const isCopy = (intent: Intent, place: PlaceView) =>
	intent.kind !== "hold" &&
	intent.from !== undefined &&
	place.copied.has(intent.from);

const isBelowSource = (folder: string, place: PlaceView) =>
	place.sourcePaths.some(
		(source) => contains(source, folder) && !contains(folder, source)
	);

function isEmptiedBy(
	removed: ReadonlySet<string>,
	folder: string,
	disk: Disk
): boolean {
	const names = disk.entriesOf(folder);
	return (
		names !== undefined &&
		names.every((name) => removed.has(path.join(folder, name)))
	);
}

const isCompiled = (folder: string, place: PlaceView) =>
	place.compiledPath !== undefined && contains(place.compiledPath, folder);

/** The removals Studio made of copied files that no hold names. */
function copiesGone(
	intents: readonly Intent[],
	place: PlaceView
): GoneIntent[] {
	const held = new Set(
		intents.flatMap((intent) =>
			intent.kind === "hold" && intent.files !== "movedFrom"
				? intent.files
				: []
		)
	);
	return intents.filter(
		(intent): intent is GoneIntent =>
			intent.kind === "gone" &&
			isCopy(intent, place) &&
			!held.has(intent.file)
	);
}

/**
 * The folders of the project that the removals Studio made of copied files
 * empty, deepest first, and the folders the place still holds that they
 * would have emptied.
 */
function pruningOf(
	gone: readonly GoneIntent[],
	disk: Disk,
	place: PlaceView
): Pruning {
	const removed = new Set(gone.map(({ file }) => file));
	const stillMounted = new Set(
		[...place.folders]
			.filter(([at]) => place.held.has(at))
			.map(([, target]) => target)
	);
	const emptiedBy = (folder: string) => isEmptiedBy(removed, folder, disk);
	const prunes: Operation[] = [];
	const leftOut: string[] = [];
	for (const [at, target] of [...place.folders].sort(
		([a], [b]) => b.length - a.length
	)) {
		if (place.held.has(at) || stillMounted.has(target)) continue;
		const folder = toNative(target);
		const instance = place.instanceAt(at);
		if (isCompiled(folder, place)) {
			leftOut.push(instance);
			continue;
		}
		if (!emptiedBy(folder)) continue;
		removed.add(folder);
		prunes.push({ kind: "prune", file: folder, instance, from: at });
	}
	const readAt = new Map<string, Set<string>>();
	const readsAt = (folder: string, at: string) =>
		readAt.set(folder, (readAt.get(folder) ?? new Set()).add(at));
	for (const [at, target] of place.folders) readsAt(toNative(target), at);
	const placeStillHolds = (folder: string) =>
		[...(readAt.get(folder) ?? [])].some((at) => place.held.has(at));
	const emptied: { file: string; instance: string; parent?: string }[] = [];
	for (const { file, from } of gone) {
		const parent = path.posix.dirname(from!);
		readsAt(path.dirname(file), parent);
		emptied.push({ file, instance: place.instanceAt(parent), parent });
	}
	for (const { file, from } of prunes)
		emptied.push({ file, instance: place.instanceAt(from!) });
	const keeps = new Map<string, string>();
	for (const { file, instance, parent } of emptied) {
		for (
			let folder = path.dirname(file);
			!removed.has(folder) && isBelowSource(folder, place);
			folder = path.dirname(folder)
		) {
			if (!emptiedBy(folder)) break;
			if (placeStillHolds(folder)) {
				keeps.set(folder, instance);
				break;
			}
			removed.add(folder);
			prunes.push({
				kind: "prune",
				file: folder,
				instance,
				...(parent !== undefined &&
					folder === path.dirname(file) && { from: parent }),
			});
		}
	}
	return { prunes, keeps, leftOut };
}

/**
 * The files a refused move's instance came from: the removals, in the
 * deepest folder that holds one for each of its files, whose bytes match.
 */
function movedFrom(
	moved: readonly MovedFile[],
	gone: readonly Intent[],
	disk: Disk
): string[] {
	const removals = gone.flatMap((intent) => {
		if (intent.kind !== "gone" || intent.from === undefined) return [];
		const bytes = disk.bytesOf(intent.file);
		return bytes !== undefined && bytes.length > 0
			? [{ file: intent.file, from: intent.from, bytes }]
			: [];
	});
	const folders = new Set<string>();
	for (const { from } of removals)
		for (
			let dir = path.posix.dirname(from);
			dir !== ".";
			dir = path.posix.dirname(dir)
		)
			folders.add(dir);
	for (const folder of [...folders].sort((a, b) => b.length - a.length)) {
		const found = moved.map(({ rel, bytes }) =>
			removals.find(
				(removal) =>
					sameBytes(removal.bytes, bytes) &&
					(rel === undefined
						? path.posix.dirname(removal.from) === folder
						: path.posix.relative(folder, removal.from) === rel)
			)
		);
		if (found.includes(undefined)) continue;
		return found.map((removal) => removal!.file);
	}
	return [];
}

/**
 * The plan's operations from the run's intents: Studio's edits and removals
 * of copied files, then the folders those removals empty, then the rest in
 * the order they were recorded. A hold keeps what a removal would take,
 * whenever it was recorded, and as in Rojo's syncback, a folder something is
 * written into is never pruned.
 */
export function retain(
	intents: readonly Intent[],
	disk: Disk,
	place: PlaceView
): Retention {
	const gone = copiesGone(intents, place);
	const pruning = pruningOf(gone, disk, place);
	const holds = intents.filter(
		(intent): intent is HoldIntent => intent.kind === "hold"
	);
	const keptFiles = holds.flatMap((hold) =>
		hold.files === "movedFrom" ? movedFrom(hold.moved, intents, disk) : []
	);
	const refused = holds
		.filter(({ files }) => files === "movedFrom")
		.map(({ instance }) => instance);
	const isKept = (operation: Operation) =>
		isRemoving(operation) &&
		(refused.some(
			(key) =>
				operation.instance === key ||
				operation.instance.startsWith(`${key}/`)
		) ||
			keptFiles.some((at) => contains(operation.file, at)));
	const named = new Set(
		holds.flatMap(({ files }) => (files === "movedFrom" ? [] : files))
	);
	const kept = intents.filter(
		(intent): intent is GoneIntent =>
			intent.kind === "gone" && named.has(intent.file)
	);
	const placed = intents.filter(
		(intent): intent is Exclude<Intent, HoldIntent> =>
			intent.kind !== "hold" &&
			!(intent.kind === "gone" && named.has(intent.file))
	);
	const listed = withoutRepeats([
		...placed.filter((intent) => isCopy(intent, place)).map(operationOf),
		...pruning.prunes,
		...placed.filter((intent) => !isCopy(intent, place)).map(operationOf),
	]).filter((operation) => !isKept(operation));
	const fills = (folder: string) =>
		listed.some(
			(operation) =>
				isFilling(operation) &&
				operation.file.startsWith(`${folder}${path.sep}`)
		);
	const operations = listed.filter(
		(operation) => operation.kind !== "prune" || !fills(operation.file)
	);
	const removed = new Set(
		operations.filter(isRemoving).map(({ file }) => file)
	);
	const gitkeeps: Operation[] = [];
	for (const [folder, instance] of pruning.keeps)
		if (!fills(folder) && isEmptiedBy(removed, folder, disk))
			gitkeeps.push({
				kind: "write",
				file: path.join(folder, GITKEEP),
				instance,
				bytes: new Uint8Array(),
			});
	return {
		operations,
		gitkeeps: gitkeeps.filter(
			(gitkeep) => !operations.some((other) => isSame(other, gitkeep))
		),
		kept,
		leftOut: pruning.leftOut,
	};
}

/** Every folder retention may read, for the removals recorded so far. */
export function foldersRead(
	intents: readonly Intent[],
	place: PlaceView
): string[] {
	const folders = new Set<string>();
	const climb = (file: string) => {
		for (
			let folder = path.dirname(file);
			isBelowSource(folder, place) && !folders.has(folder);
			folder = path.dirname(folder)
		)
			folders.add(folder);
	};
	for (const target of place.folders.values()) {
		folders.add(toNative(target));
		climb(toNative(target));
	}
	for (const intent of intents)
		if (intent.kind === "gone") climb(intent.file);
	return [...folders];
}
