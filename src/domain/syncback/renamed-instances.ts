import path from "path";
import { isSameJson } from "../../base/objects.js";
import { containsPosix } from "../../base/path.js";
import { PlacedLocation } from "../write/write-service.js";
import { RojoFile } from "../rojo/rojo.js";
import { AddedInstance } from "./added-instances.js";
import { instanceNameOf, instancePathIn } from "./reverse-router.js";
import { GITKEEP } from "./syncback-layout.js";

export interface RenamedInstance {
	readonly instance: AddedInstance;
	readonly from: string;
	readonly folder: string;
	readonly renamed: string;
	readonly files: ReadonlyMap<string, RenamedFile>;
	readonly kept: readonly string[];
}

type Found = Omit<RenamedInstance, "kept">;

export interface RenamedFile {
	readonly target: string;
	readonly keep?: string;
}

function renamedSegment(
	segment: string,
	from: string,
	to: string
): string | undefined {
	const hoisted = segment.startsWith("^") ? "^" : "";
	const name = segment.slice(hoisted.length);
	if (name === from) return `${hoisted}${to}`;
	if (name.startsWith(`${from}@`))
		return `${hoisted}${to}${name.slice(from.length)}`;
	return undefined;
}

function markOf(file: PlacedLocation): string {
	const mark = `@${file.route}`;
	return file.routeMatch === "suffix" &&
		file.routedBy === file.source &&
		instanceNameOf(path.posix.basename(file.source)).endsWith(mark)
		? mark
		: "";
}

function withMark(fileName: string, mark: string): string {
	const stem = instanceNameOf(fileName);
	return `${stem}${mark}${fileName.slice(stem.length)}`;
}

const sameForm = (old: PlacedLocation, written: string) =>
	path.posix.basename(old.source).replace(markOf(old), "") === written;

const isScript = (file: string) => /\.luau?$/.test(file);

export interface RenameInputs {
	readonly sourceOf: (mirror: string) => string | undefined;
	readonly placed: readonly PlacedLocation[];
	readonly isRemoved: (source: string) => boolean;
}

function byInstance(
	placed: readonly PlacedLocation[]
): Map<string, PlacedLocation> {
	const found = new Map<string, PlacedLocation>();
	for (const file of placed) {
		const key = file.instancePath.join("\0");
		if (!found.has(key)) found.set(key, file);
	}
	return found;
}

const isUnder = (instancePath: readonly string[], root: readonly string[]) =>
	root.every((name, at) => instancePath[at] === name) &&
	instancePath.length > root.length;

const isOf = (
	file: PlacedLocation,
	{ instance, from }: Pick<RenamedInstance, "instance" | "from">
) => {
	const old = [...instance.parent, from];
	return (
		isUnder(file.instancePath, old) || isSameJson(file.instancePath, old)
	);
};

function renameOf(
	instance: AddedInstance,
	from: string,
	inputs: RenameInputs,
	placedAt: ReadonlyMap<string, PlacedLocation>
): Found | undefined {
	const { sourceOf, placed, isRemoved } = inputs;
	const oldPath = [...instance.parent, from];
	const oldMirror = `${instance.parentFolder}/${from}`;
	const folder = placed
		.flatMap((file) => file.folderNodes ?? [])
		.find(({ instancePath }) => isSameJson(instancePath, oldPath))?.folder;
	if (folder === undefined) return undefined;
	const segment = renamedSegment(
		path.posix.basename(folder),
		from,
		instance.name
	);
	if (segment === undefined) return undefined;
	const renamed = path.posix.join(path.posix.dirname(folder), segment);
	const moved = (source: string) =>
		path.posix.join(renamed, path.posix.relative(folder, source));
	const files = new Map<string, RenamedFile>();
	const siblings = new Map<string, PlacedLocation>();
	const mapped = new Set<string>();
	const fresh: (readonly string[])[] = [];
	const empty: (readonly string[])[] = [];
	for (const file of instance.files) {
		const leaf = file[file.length - 1];
		if (leaf === GITKEEP) {
			empty.push(file);
			continue;
		}
		const key = file.join("/");
		if (RojoFile.metaStemOf(leaf) !== undefined) {
			const source = sourceOf([oldMirror, ...file.slice(1)].join("/"));
			if (source === undefined || !containsPosix(folder, source))
				return undefined;
			files.set(key, { target: moved(source) });
			continue;
		}
		const old = placedAt.get(
			instancePathIn(
				[...oldPath, ...file.slice(1, -1)],
				file[file.length - 1]
			).join("\0")
		);
		if (old === undefined) {
			fresh.push(file);
			continue;
		}
		if (!containsPosix(folder, old.source)) return undefined;
		const oldName = path.posix.basename(old.source);
		mapped.add(old.source);
		siblings.set(key, old);
		if (sameForm(old, leaf)) {
			files.set(key, { target: moved(old.source) });
			continue;
		}
		if (!isScript(oldName)) {
			files.set(key, { target: moved(old.source), keep: old.source });
			continue;
		}
		const studioEdit = path.posix.join(
			path.posix.dirname(moved(old.source)),
			withMark(leaf, markOf(old))
		);
		files.set(key, { target: studioEdit });
	}
	for (const file of fresh) {
		const leaf = file[file.length - 1];
		const dir = file.slice(0, -1).join("/");
		const beside = [...siblings].filter(
			([other]) => other.slice(0, other.lastIndexOf("/")) === dir
		);
		const marks = new Set(beside.map(([, old]) => markOf(old)));
		if (beside.length === 0 || marks.size !== 1) return undefined;
		const [mark] = marks;
		files.set(file.join("/"), {
			target: path.posix.join(
				path.posix.dirname(files.get(beside[0][0])!.target),
				withMark(leaf, mark)
			),
		});
	}
	for (const file of empty) {
		for (let depth = file.length - 1; depth > 0; depth--) {
			const dir = file.slice(0, depth).join("/");
			const beside = [...siblings.keys()].find(
				(other) => other.slice(0, other.lastIndexOf("/")) === dir
			);
			if (beside === undefined) continue;
			files.set(file.join("/"), {
				target: path.posix.join(
					path.posix.dirname(files.get(beside)!.target),
					...file.slice(depth)
				),
			});
			break;
		}
	}
	const lost = placed.some(
		(file) =>
			isOf(file, { instance, from }) &&
			!mapped.has(file.source) &&
			!isRemoved(file.source)
	);
	if (lost || files.size === 0) return undefined;
	return { instance, from, folder, renamed, files };
}

function sharedStart(a: string, b: string): number {
	let at = 0;
	while (at < a.length && a[at] === b[at]) at++;
	return at;
}

export function renamedInstances(
	instances: readonly AddedInstance[],
	removed: ReadonlySet<string>,
	inputs: RenameInputs
): RenamedInstance[] {
	const { placed } = inputs;
	const placedAt = byInstance(placed);
	const found: Found[] = [];
	for (const instance of instances) {
		if (!instance.folder) continue;
		const prefix = `${instance.parentFolder}/`;
		const claimed = (name: string) =>
			found.some(
				(other) =>
					other.from === name &&
					other.instance.parentFolder === instance.parentFolder
			);
		const names = [
			...new Set(
				[...removed]
					.filter((at) => at.startsWith(prefix))
					.map((at) => at.slice(prefix.length).split("/")[0])
					.filter((name) => name !== instance.name && !claimed(name))
			),
		].sort(
			(a, b) =>
				sharedStart(b, instance.name) - sharedStart(a, instance.name)
		);
		for (const name of names) {
			const rename = renameOf(instance, name, inputs, placedAt);
			if (rename) {
				found.push(rename);
				break;
			}
		}
	}
	return found
		.filter((rename) =>
			found.every(
				(other) =>
					other.folder !== rename.folder ||
					other.renamed === rename.renamed
			)
		)
		.map((rename) => ({
			...rename,
			kept: placed
				.filter(
					(file) =>
						containsPosix(rename.folder, file.source) &&
						!found.some(
							(other) =>
								other.folder === rename.folder &&
								isOf(file, other)
						)
				)
				.map(({ source }) => source),
		}));
}
