const LISTED_PATHS = 3;

export function listPaths(paths: readonly string[]): string {
	const listed = paths.slice(0, LISTED_PATHS).join(", ");
	return paths.length > LISTED_PATHS ? `${listed}, …` : listed;
}
