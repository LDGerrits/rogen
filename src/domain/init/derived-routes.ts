import path from "path";
import { containsPosix, normalizeDir } from "../../base/path.js";
import { DeclaredKeys } from "../config/config.js";
import { isSupportedService } from "../roblox/supported-services.js";
import {
	MountedPath,
	instanceKey,
	rojoPathTarget,
} from "../rojo/rojo-project.js";
import { StarterTemplate } from "./starter-template.js";

/** The routes that reproduce the mounts of a hand-written project file, which a copy leaves out because Rogen generates that code now. */
export class DerivedRoutes {
	/** Route key to target, one for each mount of a folder directly in a root dir. */
	readonly routes = new Map<string, string>();
	/** Where files that match no route go: the target a root dir was mounted at, else the one of the shared route. */
	readonly fallback: string | undefined;
	/** The mounts inside a root dir that no route can reproduce, as their `$path` and the node they were at. */
	readonly unrouted: { readonly target: string; readonly node: string }[] =
		[];

	constructor(
		/** The project file the mounts were in. */
		readonly from: string,
		removed: readonly MountedPath[],
		rootDirs: readonly string[]
	) {
		const roots = rootDirs.map(normalizeDir);
		let rootTarget: string | undefined;
		for (const { path: rojoPath, instancePath } of removed) {
			const target = normalizeDir(rojoPathTarget(rojoPath));
			const node = instanceKey(instancePath);
			const landing = instancePath.join("/");
			if (roots.includes(target)) {
				rootTarget ??= landing;
				continue;
			}
			if (!roots.some((root) => containsPosix(root, target))) continue;
			const key = path.posix.basename(target);
			const direct = roots.includes(path.posix.dirname(target));
			const identity = DeclaredKeys.identityOf(key);
			if (
				direct &&
				DeclaredKeys.isName(key) &&
				isSupportedService(instancePath[0]) &&
				instancePath.every((name) => !name.includes("/")) &&
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

	/** The routes for the mounts in `content` that point into `rootDirs`; `undefined` when it isn't a project file or holds none. */
	static of(
		from: string,
		content: string,
		rootDirs: readonly string[]
	): DerivedRoutes | undefined {
		const removed =
			StarterTemplate.parse(content)?.withoutNodesIn(rootDirs)?.removed;
		if (!removed) return undefined;
		const derived = new DerivedRoutes(from, removed, rootDirs);
		return derived.routes.size > 0 ||
			derived.fallback !== undefined ||
			derived.unrouted.length > 0
			? derived
			: undefined;
	}
}
