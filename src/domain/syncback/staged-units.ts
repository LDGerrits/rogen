import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { NewInstance } from "./reverse-router.js";

/** One instance Rojo wrote into staging, with every file it took. */
export interface StagedUnit extends NewInstance {
	/** The staged node it was written below. */
	readonly number: number;
	/** The files, as the path below the parent's staging folder. */
	readonly files: readonly (readonly string[])[];
}

const instanceNameOf = (fileName: string): string =>
	RojoFile.metaStemOf(fileName) ??
	new RojoFile(fileName, SyncRules.DEFAULT).instanceName;

/** Groups what Rojo wrote into staging by the instance each file belongs to. */
export class StagedUnits {
	/** `paths` are files below the staging folder: the number of the staged node, then the path below it. `nodes` are the instance paths of the staged nodes, by number. */
	static of(
		paths: readonly (readonly string[])[],
		nodes: readonly (readonly string[])[]
	): { units: StagedUnit[]; strays: string[] } {
		const units = new Map<
			string,
			{ unit: Omit<StagedUnit, "files">; files: string[][] }
		>();
		const strays: string[] = [];
		for (const [number, ...rest] of paths) {
			const parent = nodes[Number(number)];
			if (!parent || rest.length === 0) {
				strays.push([number, ...rest].join("/"));
				continue;
			}
			const folder = rest.length > 1;
			const name = folder ? rest[0] : instanceNameOf(rest[0]);
			const key = `${parent.join("\0")}\0${name}`;
			const known = units.get(key) ?? {
				unit: { number: Number(number), parent, name, folder },
				files: [],
			};
			units.set(key, known);
			known.files.push(rest);
		}
		return {
			units: [...units.values()].map(({ unit, files }) => ({
				...unit,
				files,
			})),
			strays,
		};
	}

	/** Where a file of `unit` goes in `home`: a folder's files drop the folder when the routing folder stands for it, and a mark is added to the name of what is written. */
	static destination(
		unit: StagedUnit,
		file: readonly string[],
		contents: boolean,
		mark: string
	): string[] {
		if (unit.folder)
			return contents
				? file.slice(1)
				: [`${file[0]}${mark}`, ...file.slice(1)];
		const [first] = file;
		return [
			mark !== "" && first.startsWith(unit.name)
				? `${unit.name}${mark}${first.slice(unit.name.length)}`
				: first,
		];
	}
}
