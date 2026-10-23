import { groupBy } from "../../base/collections.js";
import { LeftOut } from "./write.js";
import { RoutedFile } from "./router.js";
import { InstanceMap, instanceKey } from "../roblox/roblox.js";

/** Files from one source path that claim one instance path; the last one wins and the others are replaced. */
export interface InstanceClash {
	readonly instance: string;
	readonly winner: RoutedFile;
	readonly losers: readonly RoutedFile[];
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

export class InstanceResolver {
	resolve(routed: readonly RoutedFile[]): InstanceResolution {
		const clashes: InstanceClash[] = [];
		const winners = new InstanceMap<RoutedFile>();
		for (const root of groupBy(
			routed,
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
		const replaced = routed.flatMap((file): [string, LeftOut][] => {
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
			leftOut: replaced,
			clashes,
		};
	}
}
