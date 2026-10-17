import path from "path";
import { withGlobBody } from "../../base/glob.js";
import { toPosix } from "../../base/path.js";
import { isObject } from "../../base/objects.js";

/** A path or glob written relative to one folder, written again relative to another. */
export class PathRebaser {
	static path(value: string, from: string, to: string): string {
		if (path.isAbsolute(value)) return value;
		return toPosix(path.relative(to, path.resolve(from, value))) || ".";
	}

	static glob(glob: string, from: string, to: string): string {
		return withGlobBody(glob, (body) => {
			if (path.posix.isAbsolute(body) || path.win32.isAbsolute(body))
				return body;
			const prefix = toPosix(path.relative(to, from));
			return prefix === "" ? body : path.posix.join(prefix, body);
		});
	}

	/** Rebases the path-valued keys: the tree's `$path`s, `globIgnorePaths` and `syncPath`. */
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
