import path from "path";
import { containsPosix, normalizeDir } from "../../base/path.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { isSupportedService } from "../roblox/supported-services.js";
import { RemovedMount, rojoPathTarget } from "../rojo/rojo-project.js";
import { StarterProject } from "./starter-project.js";
import { instanceKey } from "../roblox/roblox.js";

/** A mount of a hand-written project file that no route can reproduce. */
export interface UnroutedMount {
	readonly target: string;
	readonly node: string;
	readonly mount: RemovedMount;
	/** The mount is a whole source path, which a mount in the tree can't be. */
	readonly atRoot: boolean;
	/** Why no route can make it. */
	readonly reason: string;
}

/** The routes that reproduce the mounts of a hand-written project file, which a lift leaves out. */
export class DerivedRoutes {
	readonly routes = new Map<string, string>();
	readonly fallback: string | undefined;
	readonly unrouted: UnroutedMount[] = [];

	constructor(
		readonly from: string,
		removed: readonly RemovedMount[],
		sourcePaths: readonly string[]
	) {
		const roots = sourcePaths.map(normalizeDir);
		let rootTarget: string | undefined;
		const mountsOf = new Map<string, number>();
		for (const { path: rojoPath } of removed) {
			const target = normalizeDir(rojoPathTarget(rojoPath));
			mountsOf.set(target, (mountsOf.get(target) ?? 0) + 1);
		}
		for (const mount of removed) {
			const { path: rojoPath, instancePath } = mount;
			const target = normalizeDir(rojoPathTarget(rojoPath));
			const node = instanceKey(instancePath);
			const landing = instancePath.join("/");
			const reachable =
				isSupportedService(instancePath[0]) &&
				instancePath.every((name) => !name.includes("/"));
			if (roots.includes(target)) {
				if (reachable) rootTarget ??= landing;
				else
					this.unrouted.push({
						target,
						node,
						mount,
						atRoot: true,
						reason: "no service holds the node it lands on",
					});
				continue;
			}
			if (!roots.some((root) => containsPosix(root, target))) continue;
			const key = path.posix.basename(target);
			const direct = roots.includes(path.posix.dirname(target));
			const identity = DeclaredKeys.identityOf(key);
			const taken = [...this.routes.keys()].some(
				(other) => DeclaredKeys.identityOf(other) === identity
			);
			const reason = !direct
				? "only a folder directly in a source path becomes a route"
				: !DeclaredKeys.isName(key)
					? `${key} is not a valid route name`
					: !reachable
						? "no service holds the node it lands on"
						: (mountsOf.get(target) ?? 0) > 1
							? "its folder is mounted more than once"
							: taken
								? `another folder already took the route name ${key}`
								: undefined;
			if (reason === undefined) this.routes.set(key, landing);
			else
				this.unrouted.push({
					target,
					node,
					mount,
					atRoot: false,
					reason,
				});
		}
		this.fallback =
			rootTarget ??
			[...this.routes].find(
				([key]) => DeclaredKeys.identityOf(key) === "shared"
			)?.[1];
	}

	static of(
		from: string,
		project: StarterProject,
		sourcePaths: readonly string[]
	): DerivedRoutes | undefined {
		const removed = project.withoutNodesIn(sourcePaths)?.removed;
		if (!removed) return undefined;
		const derived = new DerivedRoutes(from, removed, sourcePaths);
		return derived.routes.size > 0 ||
			derived.fallback !== undefined ||
			derived.unrouted.length > 0
			? derived
			: undefined;
	}
}
