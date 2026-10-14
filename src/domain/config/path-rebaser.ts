import path from "path";
import { toPosix } from "../../base/path.js";
import { isObject } from "../../base/objects.js";

/** A path or glob written relative to one folder, written again relative to another. */
export class PathRebaser {
	/** `value` as the folder `to` reaches the same place; an absolute path stays. */
	static path(value: string, from: string, to: string): string {
		if (path.isAbsolute(value)) return value;
		return toPosix(path.relative(to, path.resolve(from, value))) || ".";
	}

	/** `glob` as it matches the same files from the folder `to`. */
	static glob(glob: string, from: string, to: string): string {
		const prefix = toPosix(path.relative(to, from));
		return prefix === "" ? glob : path.posix.join(prefix, glob);
	}

	/** The values of a config that name paths, written for the folder `to` instead of `from`: the `$path`s of the tree, `globIgnorePaths` and `syncPath`. */
	static values(
		values: Readonly<Record<string, unknown>>,
		from: string,
		to: string
	): Record<string, unknown> {
		const rebased = structuredClone(values) as Record<string, unknown>;
		if (isObject(rebased.tree)) PathRebaser.node(rebased.tree, from, to);
		if (Array.isArray(rebased.globIgnorePaths))
			rebased.globIgnorePaths = rebased.globIgnorePaths.map((glob) =>
				typeof glob === "string"
					? PathRebaser.glob(glob, from, to)
					: glob
			);
		if (typeof rebased.syncPath === "string")
			rebased.syncPath = PathRebaser.path(rebased.syncPath, from, to);
		return rebased;
	}

	private static node(
		node: Record<string, unknown>,
		from: string,
		to: string
	): void {
		for (const [key, value] of Object.entries(node)) {
			if (key === "$path") {
				if (typeof value === "string")
					node[key] = PathRebaser.path(value, from, to);
				else if (isObject(value) && typeof value.optional === "string")
					node[key] = {
						...value,
						optional: PathRebaser.path(value.optional, from, to),
					};
			} else if (!key.startsWith("$") && isObject(value))
				PathRebaser.node(value, from, to);
		}
	}
}
