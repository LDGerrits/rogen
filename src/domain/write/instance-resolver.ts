import { groupBy } from "../../base/collections.js";
import { LeftOut } from "./write.js";
import { RoutedFile } from "./router.js";
import { InstanceMap, instanceKey } from "../roblox/roblox.js";

export interface InstanceClash {
	readonly instance: string;
	readonly winner: RoutedFile;
	readonly losers: readonly RoutedFile[];
	readonly initFolder?: string;
}

interface InstanceResolution {
	readonly nodes: readonly RoutedFile[];
	readonly leftOut: [string, LeftOut][];
	readonly clashes: InstanceClash[];
}

/**
 * Rojo reads an init file in this order when a folder has several: a module,
 * then a script that isn't a LocalScript, then a LocalScript, then any other.
 */
const initRank = ({ entry }: RoutedFile): number => {
	const { isLuauModule, scriptSuffix } = entry.file;
	if (isLuauModule) return 4;
	if (scriptSuffix === "client") return 2;
	return scriptSuffix ? 3 : 1;
};

const byInitRank = (claimants: readonly RoutedFile[]): RoutedFile[] => {
	const inits = claimants
		.filter((file) => file.init)
		.sort((a, b) => initRank(a) - initRank(b));
	return claimants.map((file) => (file.init ? inits.shift()! : file));
};

const isRojoInit = (file: RoutedFile): boolean =>
	file.init !== undefined && file.entry.file.isInit;

export class InstanceResolver {
	resolve(routed: readonly RoutedFile[]): InstanceResolution {
		const {
			kept,
			folderLosers,
			clashes: folderClashes,
		} = InstanceResolver.onePerFolder(routed);
		const clashes: InstanceClash[] = [...folderClashes];
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

	private static onePerFolder(routed: readonly RoutedFile[]): {
		kept: RoutedFile[];
		folderLosers: [string, LeftOut][];
		clashes: InstanceClash[];
	} {
		const clashes: InstanceClash[] = [];
		const losing = new Set<string>();
		const folderLosers: [string, LeftOut][] = [];
		const folders = groupBy(
			routed.filter(isRojoInit),
			(file) => `${file.entry.sourcePath}\0${file.init!.sitsIn}`
		);
		for (const files of folders.values()) {
			const bySource = [
				...new Map(
					files.map((file) => [file.entry.source, file])
				).values(),
			];
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
			clashes,
		};
	}
}
