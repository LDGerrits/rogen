import path from "path";
import { isSameJson } from "../../base/objects.js";
import { containsPosix } from "../../base/path.js";
import { PlacedLocation } from "../write/write-service.js";
import { RojoFile } from "../rojo/rojo.js";
import { AddedInstance } from "./added-instances.js";
import { instanceNameOf } from "./reverse-router.js";
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

/** The instance path below the instance a file Rojo wrote for it makes: an init file is its folder. */
function instanceBelow(file: readonly string[]): string[] {
	const leaf = file[file.length - 1];
	const folders = file.slice(1, -1);
	return leaf.startsWith("init.")
		? folders
		: [...folders, instanceNameOf(leaf)];
}

/** The `@key` a file's name carries before its extension, which a sibling written beside it repeats. */
const markOf = (fileName: string) =>
	/(@[A-Za-z][A-Za-z0-9]*)(?=\.[^@]*$)/.exec(fileName)?.[1] ?? "";

/** Whether Rojo writes `written` in the form the file `old` has, its route mark aside. */
const sameForm = (old: string, written: string) =>
	old.replace(markOf(old), "") === written;

function renameOf(
	instance: AddedInstance,
	from: string,
	sourceOf: (mirror: string) => string | undefined,
	placed: readonly PlacedLocation[]
): RenamedInstance | undefined {
	// A name routing reads as more than a name is left for placement to refuse.
	if (/^[\^(]|@/.test(instance.name)) return undefined;
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
	const fresh: (readonly string[])[] = [];
	for (const file of instance.files) {
		const leaf = file[file.length - 1];
		if (leaf === GITKEEP) continue;
		if (RojoFile.metaStemOf(leaf) !== undefined) {
			const source = sourceOf([oldMirror, ...file.slice(1)].join("/"));
			if (source === undefined || !containsPosix(folder, source))
				return undefined;
			files.set(file.join("/"), { target: moved(source) });
			continue;
		}
		const at = [...oldPath, ...instanceBelow(file)];
		const old = placed.find((one) =>
			[one.instancePath, ...(one.alsoAt ?? [])].some((where) =>
				isSameJson(where, at)
			)
		);
		if (old === undefined) {
			fresh.push(file);
			continue;
		}
		if (!containsPosix(folder, old.source)) return undefined;
		const target = moved(old.source);
		files.set(
			file.join("/"),
			sameForm(path.posix.basename(old.source), leaf)
				? { target }
				: { target, keep: old.source }
		);
	}
	for (const file of fresh) {
		const dir = file.slice(0, -1).join("/");
		const sibling = [...files].find(
			([other, { keep }]) =>
				keep === undefined &&
				other.slice(0, other.lastIndexOf("/")) === dir &&
				!other.endsWith(`/${RojoFile.INIT_META}`)
		);
		if (sibling === undefined) return undefined;
		const leaf = file[file.length - 1];
		const stem = instanceNameOf(leaf);
		const mark = markOf(path.posix.basename(sibling[1].target));
		files.set(file.join("/"), {
			target: path.posix.join(
				path.posix.dirname(sibling[1].target),
				`${stem}${mark}${leaf.slice(stem.length)}`
			),
		});
	}
	if (files.size === 0) return undefined;
	return { instance, from, folder, renamed, files };
}

const isUnder = (instancePath: readonly string[], root: readonly string[]) =>
	root.every((name, at) => instancePath[at] === name) &&
	instancePath.length > root.length;

/** The new folder instances that are old ones renamed: same parent, every file of the old one under the new name, and a folder of their own whose every instance is renamed the same way. `removed` holds each mirror path the plan removes, and `sourceOf` gives the absolute POSIX path a mirror path was copied from. */
export function renamedInstances(
	instances: readonly AddedInstance[],
	removed: ReadonlySet<string>,
	sourceOf: (mirror: string) => string | undefined,
	placed: readonly PlacedLocation[]
): RenamedInstance[] {
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
			const rename = renameOf(instance, name, sourceOf, placed);
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
				[file.instancePath, ...(file.alsoAt ?? [])].every(
					(instancePath) =>
						found.some((other) => {
							const old = [...other.instance.parent, other.from];
							return (
								other.folder === rename.folder &&
								other.renamed === rename.renamed &&
								(isUnder(instancePath, old) ||
									isSameJson(instancePath, old))
							);
						})
				)
		)
	);
}
