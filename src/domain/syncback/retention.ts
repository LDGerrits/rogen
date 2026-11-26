import path from "path";
import { contains, toNative } from "../../base/path.js";
import {
	ChangeIntent,
	GoneIntent,
	Intent,
	MovedFile,
	Operation,
	isHold,
	sameBytes,
} from "./mirror-plan.js";
import { GITKEEP } from "./syncback-layout.js";

export interface Disk {
	entriesOf(folder: string): readonly string[] | undefined;
	bytesOf(file: string): Uint8Array | undefined;
}

export interface PlaceView {
	readonly held: ReadonlySet<string>;
	readonly copied: ReadonlySet<string>;
	readonly folders: ReadonlyMap<string, string>;
	readonly sourcePaths: readonly string[];
	readonly compiledPath?: string;
	instanceAt(at: string): string;
}

export interface Retention {
	readonly operations: readonly Operation[];
	readonly gitkeeps: readonly Operation[];
	readonly leftOut: readonly string[];
}

interface Pruning {
	readonly prunes: readonly Operation[];
	readonly keeps: ReadonlyMap<string, string>;
	readonly leftOut: readonly string[];
}

interface Listing {
	readonly listed: readonly Operation[];
	readonly pruning: Pruning;
}

const isFilling = ({ kind }: Operation) =>
	kind === "write" || kind === "folder";

const isRemoving = ({ kind }: Operation) =>
	kind === "remove" || kind === "prune";

function operationOf(intent: ChangeIntent): Operation {
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

const isCopy = (intent: ChangeIntent, place: PlaceView) =>
	intent.from !== undefined && place.copied.has(intent.from);

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

function movedFrom(
	moved: readonly MovedFile[],
	intents: readonly Intent[],
	disk: Disk
): string[] {
	const removals = intents.flatMap((intent) => {
		if (
			(intent.kind !== "gone" && intent.kind !== "kept") ||
			intent.from === undefined
		)
			return [];
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

function listingOf(
	intents: readonly Intent[],
	disk: Disk,
	place: PlaceView
): Listing {
	const changes = intents.filter(
		(intent): intent is ChangeIntent => !isHold(intent)
	);
	const pruning = pruningOf(
		changes.filter(
			(intent): intent is GoneIntent =>
				intent.kind === "gone" && isCopy(intent, place)
		),
		disk,
		place
	);
	const refused = intents.flatMap((intent) =>
		intent.kind === "refused" || intent.kind === "refusedMove"
			? [intent.instance]
			: []
	);
	const keptFiles = intents.flatMap((intent) =>
		intent.kind === "refusedMove"
			? movedFrom(intent.moved, intents, disk)
			: []
	);
	const isKept = (operation: Operation) =>
		isRemoving(operation) &&
		(refused.some(
			(key) =>
				operation.instance === key ||
				operation.instance.startsWith(`${key}/`)
		) ||
			keptFiles.some((at) => contains(operation.file, at)));
	const listed = withoutRepeats([
		...changes.filter((intent) => isCopy(intent, place)).map(operationOf),
		...pruning.prunes,
		...changes.filter((intent) => !isCopy(intent, place)).map(operationOf),
	]).filter((operation) => !isKept(operation));
	return { listed, pruning };
}

export function beforePlacement(
	intents: readonly Intent[],
	disk: Disk,
	place: PlaceView
): readonly Operation[] {
	return listingOf(intents, disk, place).listed;
}

export function retain(
	intents: readonly Intent[],
	disk: Disk,
	place: PlaceView
): Retention {
	const { listed, pruning } = listingOf(intents, disk, place);
	const fillsBelow = (folder: string) =>
		listed.some(
			(operation) =>
				isFilling(operation) &&
				operation.file.startsWith(`${folder}${path.sep}`)
		);
	// Rojo's syncback lists no removal of a folder it writes into.
	const operations = listed.filter(
		(operation) =>
			operation.kind !== "prune" ||
			!(
				fillsBelow(operation.file) ||
				listed.some(
					(other) => isFilling(other) && other.file === operation.file
				)
			)
	);
	const removed = new Set(
		operations.filter(isRemoving).map(({ file }) => file)
	);
	const gitkeeps: Operation[] = [];
	for (const [folder, instance] of pruning.keeps)
		if (!fillsBelow(folder) && isEmptiedBy(removed, folder, disk))
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
		leftOut: pruning.leftOut,
	};
}

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
