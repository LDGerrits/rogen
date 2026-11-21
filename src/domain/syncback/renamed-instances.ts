import path from "path";
import { isSameJson } from "../../base/objects.js";
import { containsPosix } from "../../base/path.js";
import { PlacedLocation } from "../write/write-service.js";
import { RojoFile } from "../rojo/rojo.js";
import { AddedInstance } from "./added-instances.js";
import { instanceNameOf, instancePathIn } from "./reverse-router.js";
import { GITKEEP } from "./syncback-layout.js";

/** A new folder instance that is an old one renamed in Studio: its files go where the old ones were, in the old folder under its new name, so the layout stays. */
export interface RenamedInstance {
	readonly instance: AddedInstance;
	/** The name it had. */
	readonly from: string;
	/** Absolute POSIX path of the folder the old instance came from. */
	readonly folder: string;
	/** That folder with the new name. */
	readonly renamed: string;
	/** Each file of the instance, joined with `/`, and where it goes. */
	readonly files: ReadonlyMap<string, RenamedFile>;
}

/** Where a file of a renamed instance goes, as an absolute POSIX path. */
export interface RenamedFile {
	readonly target: string;
	/** The old file, moved as it is, when Rojo writes the instance in another form than the file had, as a module for a JSON file. */
	readonly keep?: string;
}

/** The folder name `segment` with the instance name `from` in it changed to `to`, as `Shop@Server` → `ShopX@Server`; none when the name isn't spelled in it. */
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

/** The `@key` that routed a placed file, spelled in its own name, which a sibling written beside it repeats. */
function markOf(file: PlacedLocation): string {
	const mark = `@${file.route}`;
	return file.routeMatch === "suffix" &&
		file.routedBy === file.source &&
		instanceNameOf(path.posix.basename(file.source)).endsWith(mark)
		? mark
		: "";
}

/** `fileName` with `mark` after the name of the instance it makes, as `Hit@Server.luau`. */
function withMark(fileName: string, mark: string): string {
	const stem = instanceNameOf(fileName);
	return `${stem}${mark}${fileName.slice(stem.length)}`;
}

/** Whether Rojo writes `written` in the form the file `old` has, its route mark aside. */
const sameForm = (old: PlacedLocation, written: string) =>
	path.posix.basename(old.source).replace(markOf(old), "") === written;

/** A script, whose source Rojo writes back, unlike a data file it would write in another form. */
const isScript = (file: string) => /\.luau?$/.test(file);

/** What `renamedInstances` reads besides the instances. */
export interface RenameInputs {
	/** The absolute POSIX path a mirror path was copied from. */
	readonly sourceOf: (mirror: string) => string | undefined;
	readonly placed: readonly PlacedLocation[];
	/** Whether the plan removes the file at an absolute POSIX path, or a folder above it. */
	readonly isRemoved: (source: string) => boolean;
}

/** The placed files by the instance path each is at, joined with `\0`. */
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

function renameOf(
	instance: AddedInstance,
	from: string,
	inputs: RenameInputs,
	placedAt: ReadonlyMap<string, PlacedLocation>
): RenamedInstance | undefined {
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
	/** The old file each file of the instance is, which a new sibling is written like. */
	const siblings = new Map<string, PlacedLocation>();
	/** Every old file a file of the instance stands for. */
	const mapped = new Set<string>();
	const fresh: (readonly string[])[] = [];
	for (const file of instance.files) {
		const leaf = file[file.length - 1];
		if (leaf === GITKEEP) continue;
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
		// A script Rojo writes in another form keeps Studio's edit under the new name.
		files.set(key, {
			target: path.posix.join(
				path.posix.dirname(moved(old.source)),
				withMark(leaf, markOf(old))
			),
		});
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
	const lost = placed.some(
		(file) =>
			(isUnder(file.instancePath, oldPath) ||
				isSameJson(file.instancePath, oldPath)) &&
			!mapped.has(file.source) &&
			!isRemoved(file.source)
	);
	if (lost || files.size === 0) return undefined;
	return { instance, from, folder, renamed, files };
}

const isUnder = (instancePath: readonly string[], root: readonly string[]) =>
	root.every((name, at) => instancePath[at] === name) &&
	instancePath.length > root.length;

/** The new folder instances that are old ones renamed: same parent, every file of the old one under the new name or removed, and a folder of their own whose every instance is renamed the same way. `removed` holds each mirror path the plan removes. Whether the files land where the instance is is for routing to say. */
export function renamedInstances(
	instances: readonly AddedInstance[],
	removed: ReadonlySet<string>,
	inputs: RenameInputs
): RenamedInstance[] {
	const { placed } = inputs;
	const placedAt = byInstance(placed);
	const found: RenamedInstance[] = [];
	for (const instance of instances) {
		if (!instance.folder) continue;
		const prefix = `${instance.parentFolder}/`;
		const names = new Set(
			[...removed]
				.filter((at) => at.startsWith(prefix))
				.map((at) => at.slice(prefix.length).split("/")[0])
				.filter((name) => name !== instance.name)
		);
		for (const name of names) {
			const rename = renameOf(instance, name, inputs, placedAt);
			if (rename) {
				found.push(rename);
				break;
			}
		}
	}
	return found.filter((rename) =>
		placed.every(
			(file) =>
				!containsPosix(rename.folder, file.source) ||
				found.some((other) => {
					const old = [...other.instance.parent, other.from];
					return (
						other.folder === rename.folder &&
						other.renamed === rename.renamed &&
						(isUnder(file.instancePath, old) ||
							isSameJson(file.instancePath, old))
					);
				})
		)
	);
}
