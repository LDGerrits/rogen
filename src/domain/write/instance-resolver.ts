import { groupBy } from "../../base/collections.js";
import { LeftOut } from "./write.js";
import { RoutedFile } from "./router.js";
import { InstanceMap, instanceKey } from "../roblox/roblox.js";

/** Files from one source path that claim one instance path; the last one wins and the others are replaced. */
export interface InstanceClash {
	readonly instance: string;
	readonly winner: RoutedFile;
	readonly losers: readonly RoutedFile[];
	/** Set when the files are init files of this folder, of which Rojo reads only one, wherever their routes send them. */
	readonly initFolder?: string;
}

interface InstanceResolution {
	/** Every instance path appears once per write; the last source path wins across roots. */
	readonly nodes: readonly RoutedFile[];
	/** The files another file replaced. */
	readonly leftOut: [string, LeftOut][];
	readonly clashes: InstanceClash[];
}

/** Rojo reads an init file in this order when a folder has several: a module, then a script that isn't a LocalScript, then a LocalScript, then any other. */
const initRank = ({ entry }: RoutedFile): number => {
	const { isLuauModule, scriptSuffix } = entry.file;
	if (isLuauModule) return 4;
	if (scriptSuffix === "client") return 2;
	return scriptSuffix ? 3 : 1;
};

/** `claimants` with the init files among them in Rojo's order, each in a place an init file held. */
const byInitRank = (claimants: readonly RoutedFile[]): RoutedFile[] => {
	const inits = claimants
		.filter((file) => file.init)
		.sort((a, b) => initRank(a) - initRank(b));
	return claimants.map((file) => (file.init ? inits.shift()! : file));
};

/** An init file Rojo reads as its folder, which it reads through the directory, so the folder's other such files are never read. */
const isRojoInit = (file: RoutedFile): boolean =>
	file.init !== undefined && file.entry.file.isInit;

export class InstanceResolver {
	resolve(routed: readonly RoutedFile[]): InstanceResolution {
		const clashes: InstanceClash[] = [];
		const { kept, folderLosers } = InstanceResolver.onePerFolder(
			routed,
			clashes
		);
		const winners = new InstanceMap<RoutedFile>();
		for (const root of groupBy(
			kept,
			(file) => file.entry.sourcePath
		).values()) {
			for (const [instance, claimed] of groupBy(root, (file) =>
				instanceKey(file.instancePath)
			)) {
				const claimants = byInitRank(claimed);
				const winner = claimants[claimants.length - 1];
				if (claimants.length > 1)
					clashes.push({
						instance,
						winner,
						losers: claimants.slice(0, -1),
					});
				winners.set(claimants[0].instancePath, winner);
			}
		}
		const replaced = kept.flatMap((file): [string, LeftOut][] => {
			const winner = winners.get(file.instancePath);
			return winner && winner !== file
				? [
						[
							file.entry.source,
							{ status: "replaced", by: winner.entry.source },
						],
					]
				: [];
		});
		return {
			nodes: [...new Set(winners.values())],
			leftOut: [...folderLosers, ...replaced],
			clashes,
		};
	}

	/** Keeps the one init file of each folder that Rojo reads, in its order, and replaces the folder's others, wherever their routes send them. */
	private static onePerFolder(
		routed: readonly RoutedFile[],
		clashes: InstanceClash[]
	): { kept: RoutedFile[]; folderLosers: [string, LeftOut][] } {
		const losing = new Set<string>();
		const folderLosers: [string, LeftOut][] = [];
		const folders = groupBy(
			routed.filter(isRojoInit),
			(file) => `${file.entry.sourcePath}\0${file.init!.sitsIn}`
		);
		for (const files of folders.values()) {
			const bySource = [
				...new Map(files.map((file) => [file.entry.source, file])),
			].map(([, file]) => file);
			if (bySource.length < 2) continue;
			const ranked = byInitRank(bySource);
			const winner = ranked[ranked.length - 1];
			const losers = ranked.slice(0, -1);
			clashes.push({
				instance: instanceKey(winner.instancePath),
				winner,
				losers,
				initFolder: winner.init!.sitsIn,
			});
			for (const { entry } of losers) {
				losing.add(entry.source);
				folderLosers.push([
					entry.source,
					{ status: "replaced", by: winner.entry.source },
				]);
			}
		}
		return {
			kept: routed.filter((file) => !losing.has(file.entry.source)),
			folderLosers,
		};
	}
}
