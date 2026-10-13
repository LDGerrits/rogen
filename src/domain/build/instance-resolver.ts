import { groupBy } from "../../base/collections.js";
import { LeftOut } from "./build.js";
import { RoutedFile } from "./router.js";
import { InstanceMap, instanceKey } from "../roblox/roblox.js";

/** Files from one root dir that claim one instance path; the last one wins and the others are replaced. */
export interface InstanceClash {
	readonly instance: string;
	readonly winner: RoutedFile;
	readonly losers: readonly RoutedFile[];
}

export interface InstanceResolution {
	/** Every instance path appears once per build; the last root dir wins across roots. */
	readonly nodes: readonly RoutedFile[];
	/** The files another file replaced. */
	readonly leftOut: [string, LeftOut][];
	readonly clashes: InstanceClash[];
}

/** Decides which of the routed files stay in the tree when several share an instance path: the last wins. */
export class InstanceResolver {
	resolve(routed: readonly RoutedFile[]): InstanceResolution {
		const clashes: InstanceClash[] = [];
		const winners = new InstanceMap<RoutedFile>();
		for (const root of groupBy(
			routed,
			(file) => file.entry.rootDir
		).values()) {
			for (const [instance, claimants] of groupBy(root, (file) =>
				instanceKey(file.instancePath)
			)) {
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
