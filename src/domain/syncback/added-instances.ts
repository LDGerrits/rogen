import { NewInstance, instanceNameOf } from "./reverse-router.js";

export interface AddedPath {
	readonly path: string;
	readonly folder: boolean;
}

export interface AddedInstance extends NewInstance {
	readonly files: readonly (readonly string[])[];
	readonly parentFolder: string;
}

export function addedInstances(
	added: readonly AddedPath[],
	known: (folder: string) => boolean,
	instancePathOf: (folder: string) => string[]
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
			parent: instancePathOf(unit.parent.join("/")),
			parentFolder: unit.parent.join("/"),
		})),
		strays,
	};
}
