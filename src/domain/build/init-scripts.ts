import { groupBy } from "../../base/collections.js";
import { ResolvedConfig } from "../config/config.js";
import { BuildTemplate } from "./build-template.js";
import { InitToCopy, RoutedFile } from "./router.js";
import { InstanceMap } from "../roblox/roblox.js";

/** The init scripts that stand for their whole folder: copied to every node the folder becomes, and dropped when nothing is left at a node to parent. */
export class InitScripts {
	constructor(
		private readonly config: ResolvedConfig,
		private readonly template: BuildTemplate
	) {}

	/** Each root dir's routed files, then the copies of its init scripts. */
	withCopies(
		routed: readonly RoutedFile[],
		toCopy: readonly InitToCopy[]
	): RoutedFile[] {
		const toCopyByRoot = groupBy(toCopy, ({ entry }) => entry.rootDir);
		return [...groupBy(routed, ({ entry }) => entry.rootDir)].flatMap(
			([rootDir, fromRoot]) => [
				...fromRoot,
				...this.copies(toCopyByRoot.get(rootDir) ?? [], fromRoot),
			]
		);
	}

	/** An init ModuleScript no route sends anywhere is every node its folder becomes, so each of the others gets a copy of it. */
	private copies(
		toCopy: readonly InitToCopy[],
		routed: readonly RoutedFile[]
	): RoutedFile[] {
		if (toCopy.length === 0) return [];
		// An init script that can be placed is its own folder's node, so a copy doesn't take it.
		const owned = new InstanceMap<true>();
		for (const file of routed)
			if (file.init && this.config.allVariantsOn(file.variants))
				owned.set(file.instancePath, true);
		const throughFolder = groupBy(
			routed.flatMap((file) =>
				file.folderNodes.map(({ folder }, at) => ({ file, folder, at }))
			),
			({ folder }) => folder
		);
		return toCopy.flatMap(({ entry, variants, init, placed }) => {
			const taken = new InstanceMap<true>();
			if (placed) taken.set(placed.instancePath, true);
			const copies: RoutedFile[] = [];
			for (const { file, at } of throughFolder.get(init.becomes) ?? []) {
				const { instancePath } = file.folderNodes[at];
				if (owned.get(instancePath) || taken.get(instancePath))
					continue;
				taken.set(instancePath, true);
				copies.push({
					entry,
					route: file.route,
					routeMatch: "copy",
					instancePath,
					folderNodes: file.folderNodes.slice(0, at + 1),
					outrankedFolderRoutes: [],
					ignoredAts: [],
					variants,
					variantNodes: variants.map(() => instancePath),
					init,
					...(file.hoisted && { hoisted: true }),
				});
			}
			return copies;
		});
	}

	/** An init script parents what its folder holds, so it goes where nothing placed is left at its node; the fallback's own placement goes too once a copy that the template keeps carries it. Repeats, since a dropped init script empties the folders above it. */
	withoutLoneInits(nodes: readonly RoutedFile[]): readonly RoutedFile[] {
		let kept = nodes;
		for (;;) {
			const next = this.withoutLoneInitsOnce(kept);
			if (next.length === kept.length) return kept;
			kept = next;
		}
	}

	private withoutLoneInitsOnce(
		nodes: readonly RoutedFile[]
	): readonly RoutedFile[] {
		const named = new InstanceMap<true>();
		for (const { folderNodes, routeMatch, init } of nodes)
			if (routeMatch !== "copy")
				for (const { instancePath } of init
					? folderNodes.slice(0, -1)
					: folderNodes)
					named.set(instancePath, true);
		const carried = new Set(
			nodes
				.filter(
					(copy) =>
						copy.routeMatch === "copy" &&
						named.get(copy.instancePath) &&
						!this.template.displacing(copy)
				)
				.map(({ entry }) => entry.source)
		);
		return nodes.filter(({ routeMatch, init, entry, instancePath }) =>
			routeMatch === "copy"
				? named.get(instancePath)
				: !init || !carried.has(entry.source) || named.get(instancePath)
		);
	}
}
