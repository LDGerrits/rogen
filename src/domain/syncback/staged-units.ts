import { NewInstance, instanceNameOf } from "./reverse-router.js";

/** One instance Rojo wrote into staging, with every file it took. */
export interface StagedUnit extends NewInstance {
	/** The staged node it was written below. */
	readonly number: number;
	/** The files, as the path below the parent's staging folder. */
	readonly files: readonly (readonly string[])[];
}

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
}
