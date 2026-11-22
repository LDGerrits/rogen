import path from "path";
import { groupBy } from "../../base/collections.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { LeftOut } from "./write.js";
import { RoutedFile } from "./router.js";
import { InstanceMap, instanceKey } from "../roblox/roblox.js";

export interface ClashWinner {
	readonly source: string;
	readonly isInit: boolean;
}

export interface InstanceClash {
	readonly instance: string;
	readonly winner: ClashWinner;
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
export const initRank = ({ isLuauModule, scriptSuffix }: RojoFile): number => {
	if (isLuauModule) return 4;
	if (scriptSuffix === "client") return 2;
	return scriptSuffix ? 3 : 1;
};

const byInitRank = (claimants: readonly RoutedFile[]): RoutedFile[] => {
	const inits = claimants
		.filter((file) => file.init)
		.sort((a, b) => initRank(a.entry.file) - initRank(b.entry.file));
	return claimants.map((file) => (file.init ? inits.shift()! : file));
};

const isRojoInit = (file: RoutedFile): boolean =>
	file.init !== undefined && file.entry.file.isInit;

export class InstanceResolver {
	constructor(
		private readonly listing: (dir: string) => ReadonlyMap<string, unknown>
	) {}

	resolve(routed: readonly RoutedFile[]): InstanceResolution {
		const {
			kept,
			folderLosers,
			clashes: folderClashes,
		} = this.onePerFolder(routed);
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
						winner: {
							source: winner.entry.source,
							isInit: winner.init !== undefined,
						},
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

	/**
	 * Rojo reads the init file of a folder without looking at
	 * globIgnorePaths, so an init file that no route takes, or that a glob
	 * ignores, still becomes the folder when it ranks first.
	 */
	private shadowOf(
		file: RoutedFile,
		routedSources: ReadonlySet<string>
	): string | undefined {
		const dir = file.init!.sitsIn;
		const own = initRank(file.entry.file);
		let shadow: { source: string; rank: number } | undefined;
		for (const name of [...this.listing(dir).keys()].sort()) {
			const source = path.posix.join(dir, name);
			const candidate = new RojoFile(name, SyncRules.DEFAULT);
			const rank = initRank(candidate);
			if (
				candidate.isInit &&
				rank > own &&
				rank > (shadow?.rank ?? 0) &&
				!routedSources.has(source)
			)
				shadow = { source, rank };
		}
		return shadow?.source;
	}

	private onePerFolder(routed: readonly RoutedFile[]): {
		kept: RoutedFile[];
		folderLosers: [string, LeftOut][];
		clashes: InstanceClash[];
	} {
		const clashes: InstanceClash[] = [];
		const losing = new Set<string>();
		const folderLosers: [string, LeftOut][] = [];
		const routedSources = new Set(routed.map(({ entry }) => entry.source));
		for (const file of routed.filter(isRojoInit)) {
			const { source } = file.entry;
			const shadow = this.shadowOf(file, routedSources);
			if (shadow === undefined || losing.has(source)) continue;
			clashes.push({
				instance: instanceKey(file.instancePath),
				winner: { source: shadow, isInit: true },
				losers: [file],
				initFolder: file.init!.sitsIn,
			});
			losing.add(source);
			folderLosers.push([source, { status: "replaced", by: shadow }]);
		}
		const folders = groupBy(
			routed.filter(
				(file) => isRojoInit(file) && !losing.has(file.entry.source)
			),
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
				winner: { source: winner.entry.source, isInit: true },
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
