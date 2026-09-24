import { toPosix } from "../../base/path.js";

/** Whether `target` is one of `ignored`, or lies under one of them. */
export function isIgnored(target: string, ignored: readonly string[]): boolean {
	const posixTarget = toPosix(target);
	return ignored.some((entry) => {
		const posixEntry = toPosix(entry);
		return (
			posixTarget === posixEntry ||
			posixTarget.startsWith(`${posixEntry}/`)
		);
	});
}
