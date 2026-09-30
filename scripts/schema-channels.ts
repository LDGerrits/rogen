const isPrerelease = (version: string): boolean => version.includes("-");

const versionParts = (version: string): number[] =>
	version.split(".").map(Number);

const majorOf = (version: string): string => version.split(".")[0];

/** Compares stable versions numerically, so 2.10.0 sorts after 2.9.0. */
function compareVersions(a: string, b: string): number {
	const [left, right] = [versionParts(a), versionParts(b)];
	for (let i = 0; i < 3; i++) {
		const difference = (left[i] ?? 0) - (right[i] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

/**
 * The paths a release publishes to. A pre-release only gets its exact version,
 * so a breaking change can't reach stable users. An alias is skipped when a
 * newer stable release is already published, so a late patch to an older line
 * can't roll it back.
 */
export function schemaChannels(
	version: string,
	published: readonly string[] = []
): readonly string[] {
	if (isPrerelease(version)) return [version];

	const newer = published.filter(
		(other) => !isPrerelease(other) && compareVersions(other, version) > 0
	);
	const major = majorOf(version);
	return [
		version,
		...(newer.some((other) => majorOf(other) === major) ? [] : [major]),
		...(newer.length > 0 ? [] : ["latest"]),
	];
}
