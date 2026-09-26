import { toPosix } from "../../base/path.js";

export type IgnoredPath = string | RegExp;

/** Whether `target` is one of `ignored`, or lies under one; a pattern matches the posix form of the whole path. */
export function isIgnored(
	target: string,
	ignored: readonly IgnoredPath[]
): boolean {
	const posixTarget = toPosix(target);
	return ignored.some((entry) => {
		if (entry instanceof RegExp) return entry.test(posixTarget);
		const posixEntry = toPosix(entry);
		return (
			posixTarget === posixEntry ||
			posixTarget.startsWith(`${posixEntry}/`)
		);
	});
}
