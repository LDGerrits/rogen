import path from "path";
import { containsPosix, normalizeDir } from "../../base/path.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { isSupportedService } from "../roblox/supported-services.js";
import { MountedPath, rojoPathTarget } from "../rojo/rojo-project.js";
import { StarterProject } from "./starter-project.js";
import { instanceKey } from "../roblox/roblox.js";

/** The routes that reproduce the mounts of a hand-written project file, which a lift leaves out. */
export class DerivedRoutes {
	readonly routes = new Map<string, string>();
	readonly fallback: string | undefined;
	readonly unrouted: { readonly target: string; readonly node: string }[] =
		[];

	constructor(
		readonly from: string,
		removed: readonly MountedPath[],
		sourcePaths: readonly string[]
	) {
		const roots = sourcePaths.map(normalizeDir);
		let rootTarget: string | undefined;
		for (const { path: rojoPath, instancePath } of removed) {
			const target = normalizeDir(rojoPathTarget(rojoPath));
			const node = instanceKey(instancePath);
			const landing = instancePath.join("/");
			const reachable =
				isSupportedService(instancePath[0]) &&
				instancePath.every((name) => !name.includes("/"));
			if (roots.includes(target)) {
				if (reachable) rootTarget ??= landing;
				else this.unrouted.push({ target, node });
				continue;
			}
			if (!roots.some((root) => containsPosix(root, target))) continue;
			const key = path.posix.basename(target);
			const direct = roots.includes(path.posix.dirname(target));
			const identity = DeclaredKeys.identityOf(key);
			if (
				direct &&
				DeclaredKeys.isName(key) &&
				reachable &&
				![...this.routes.keys()].some(
					(taken) => DeclaredKeys.identityOf(taken) === identity
				)
			)
				this.routes.set(key, landing);
			else this.unrouted.push({ target, node });
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
