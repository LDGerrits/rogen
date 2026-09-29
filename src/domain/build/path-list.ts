import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";

const LISTED_PATHS = 3;
const DIAGNOSED_PATHS = 10;

export function listPaths(paths: readonly string[]): string {
	const listed = paths.slice(0, LISTED_PATHS).join(", ");
	return paths.length > LISTED_PATHS ? `${listed}, …` : listed;
}

/** One diagnostic per path, up to a cap, then one that counts the rest. */
export function diagnosePaths(
	paths: readonly string[],
	diagnose: (path: string) => Diagnostic,
	countRest: (count: number) => Diagnostic
): Diagnostic[] {
	const diagnosed = paths.slice(0, DIAGNOSED_PATHS).map(diagnose);
	return paths.length > DIAGNOSED_PATHS
		? [...diagnosed, countRest(paths.length - DIAGNOSED_PATHS)]
		: diagnosed;
}
