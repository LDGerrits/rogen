import path from "path";
import { isSameJson } from "../../base/objects.js";
import { containsPosix } from "../../base/path.js";
import { PlacedLocation } from "../write/write-service.js";
import { AddedInstance } from "./added-instances.js";

/** A new folder instance that is an old one renamed in Studio: its files go where the old ones were, in the old folder under its new name, so the layout stays. */
export interface RenamedInstance {
	readonly instance: AddedInstance;
	/** The name it had. */
	readonly from: string;
	/** Absolute POSIX path of the folder the old instance came from. */
	readonly folder: string;
	/** That folder with the new name. */
	readonly renamed: string;
	/** Each file of the instance, joined with `/`, and the absolute POSIX path it goes to. */
	readonly files: ReadonlyMap<string, string>;
}

const GITKEEP = ".gitkeep";

/** The old source of the mirror path `at`, through the removal of it or of a folder above it; `removed` maps a mirror path to the absolute POSIX path it was. */
function sourceOf(
	at: string,
	removed: ReadonlyMap<string, string>
): string | undefined {
	const names = at.split("/");
	for (let depth = names.length; depth > 0; depth--) {
		const source = removed.get(names.slice(0, depth).join("/"));
		if (source !== undefined)
			return path.posix.join(source, ...names.slice(depth));
	}
	return undefined;
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

function renameOf(
	instance: AddedInstance,
	from: string,
	removed: ReadonlyMap<string, string>,
	placed: readonly PlacedLocation[]
): RenamedInstance | undefined {
	const oldPath = [...instance.parent, from];
	const oldMirror = `${instance.parentFolder}/${from}`;
	const sources: [string, string][] = [];
	for (const file of instance.files) {
		if (file[file.length - 1] === GITKEEP) continue;
		const source = sourceOf(
			[oldMirror, ...file.slice(1)].join("/"),
			removed
		);
		if (source === undefined) return undefined;
		sources.push([file.join("/"), source]);
	}
	if (sources.length === 0) return undefined;
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
	const kept = new Set(sources.map(([, source]) => source));
	const lost = placed.some(
		(file) => isUnder(file.instancePath, oldPath) && !kept.has(file.source)
	);
	if (lost || sources.some(([, source]) => !containsPosix(folder, source)))
		return undefined;
	return {
		instance,
		from,
		folder,
		renamed,
		files: new Map(
			sources.map(([file, source]) => [
				file,
				path.posix.join(renamed, path.posix.relative(folder, source)),
			])
		),
	};
}

const isUnder = (instancePath: readonly string[], root: readonly string[]) =>
	root.every((name, at) => instancePath[at] === name) &&
	instancePath.length > root.length;

/** The new folder instances that are old ones renamed: same parent, every file of the old one under the new name, and a folder of their own whose every instance is renamed the same way. `removed` maps each mirror path the plan removes to the absolute POSIX path it was. */
export function renamedInstances(
	instances: readonly AddedInstance[],
	removed: ReadonlyMap<string, string>,
	placed: readonly PlacedLocation[]
): RenamedInstance[] {
	const found: RenamedInstance[] = [];
	for (const instance of instances) {
		if (!instance.folder) continue;
		const prefix = `${instance.parentFolder}/`;
		const names = new Set(
			[...removed.keys()]
				.filter((at) => at.startsWith(prefix))
				.map((at) => at.slice(prefix.length).split("/")[0])
				.filter((name) => name !== instance.name)
		);
		for (const name of names) {
			const rename = renameOf(instance, name, removed, placed);
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
						found.some(
							(other) =>
								other.folder === rename.folder &&
								other.renamed === rename.renamed &&
								isUnder(instancePath, [
									...other.instance.parent,
									other.from,
								])
						) ||
						isSameJson(instancePath, [
							...rename.instance.parent,
							rename.from,
						])
				)
		)
	);
}
