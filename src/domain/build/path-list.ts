import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";

const LISTED_PATHS = 3;
const DIAGNOSED_PATHS = 10;

export function listPaths(paths: readonly string[]): string {
	const listed = paths.slice(0, LISTED_PATHS).join(", ");
	return paths.length > LISTED_PATHS ? `${listed}, …` : listed;
}

/** One diagnostic per path, up to a cap; the last one says how many more went unlisted. */
export function diagnosePaths(
	paths: readonly string[],
	diagnose: (path: string) => Diagnostic
): Diagnostic[] {
	const diagnosed = paths.slice(0, DIAGNOSED_PATHS).map(diagnose);
	const unlisted = paths.length - diagnosed.length;
	if (unlisted === 0) return diagnosed;
	const last = diagnosed[diagnosed.length - 1];
	return [
		...diagnosed.slice(0, -1),
		{
			...last,
			message: `${last.message} ${unlisted} more like it ${unlisted === 1 ? "isn't" : "aren't"} listed.`,
		},
	];
}
