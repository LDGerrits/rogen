import { groupBy } from "../../base/collections.js";
import { WriteTree } from "./write-tree.js";
import { InitToCopy, RoutedFile } from "./router.js";
import { InstanceMap } from "../roblox/roblox.js";

/** The init scripts that stand for their whole folder: copied to every node the folder becomes. */
export class InitScripts {
	constructor(private readonly tree: WriteTree) {}

	/** Each source path's routed files, then the copies of its init scripts. */
	withCopies(
		routed: readonly RoutedFile[],
		toCopy: readonly InitToCopy[]
	): RoutedFile[] {
		const toCopyByRoot = groupBy(toCopy, ({ entry }) => entry.sourcePath);
		return [...groupBy(routed, ({ entry }) => entry.sourcePath)].flatMap(
			([sourcePath, fromRoot]) => [
				...fromRoot,
				...this.copies(toCopyByRoot.get(sourcePath) ?? [], fromRoot),
			]
		);
	}

	private copies(
		toCopy: readonly InitToCopy[],
		routed: readonly RoutedFile[]
	): RoutedFile[] {
		if (toCopy.length === 0) return [];
		const owned = new InstanceMap<true>();
		for (const file of routed)
			if (file.init) owned.set(file.instancePath, true);
		const throughFolder = groupBy(
			routed.flatMap((file) =>
				file.folderNodes.map(({ folder }, at) => ({ file, folder, at }))
			),
			({ folder }) => folder
		);
		return toCopy.flatMap(({ entry, init, placed }) => {
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
					init,
					...(file.hoisted && { hoisted: true }),
				});
			}
			return copies;
		});
	}

	/** Drops the init scripts that have nothing left at their node to parent. */
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
						!this.tree.displacing(copy)
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
