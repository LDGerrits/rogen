import { NewInstance, instanceNameOf } from "./reverse-router.js";

/** A path Rojo created in the mirror: a file, or a folder with nothing in it. */
export interface AddedPath {
	/** Relative to the mirror's root, written with `/`. */
	readonly path: string;
	readonly folder: boolean;
}

/** An instance the place holds that no file of the project made, with the mirror paths Rojo wrote for it. */
export interface AddedInstance extends NewInstance {
	readonly files: readonly (readonly string[])[];
	/** The mirror folder its parent is, so `files` resolve against it. */
	readonly parentFolder: string;
}

/** Groups what Rojo created in the mirror by the instance each path makes: the first name below a folder that was there before is the instance. `known` says whether a mirror folder was there before the run; a path below none is a stray. */
export function addedInstances(
	added: readonly AddedPath[],
	known: (folder: string) => boolean
): { instances: AddedInstance[]; strays: string[] } {
	const units = new Map<
		string,
		{ parent: string[]; name: string; folder: boolean; files: string[][] }
	>();
	const strays: string[] = [];
	for (const { path, folder } of added) {
		const names = path.split("/");
		let depth = 0;
		while (
			depth < names.length - 1 &&
			known(names.slice(0, depth + 1).join("/"))
		)
			depth++;
		if (depth === 0) {
			strays.push(path);
			continue;
		}
		const parent = names.slice(0, depth);
		const isFolder = names.length > depth + 1 || folder;
		const name = isFolder ? names[depth] : instanceNameOf(names[depth]);
		const key = `${parent.join("/")}\0${name}`;
		const unit = units.get(key) ?? {
			parent,
			name,
			folder: isFolder,
			files: [],
		};
		units.set(key, unit);
		unit.files.push(names.slice(depth));
	}
	return {
		instances: [...units.values()].map((unit) => ({
			...unit,
			parentFolder: unit.parent.join("/"),
		})),
		strays,
	};
}
