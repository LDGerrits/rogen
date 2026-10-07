const isPrerelease = (version: string): boolean => version.includes("-");

const versionParts = (version: string): number[] =>
	version.split(".").map(Number);

const majorOf = (version: string): string => version.split(".")[0];

/** A pre-release such as 2.0.0-beta.1, which comes before every stable release of its major. */
const opensMajor = (version: string): boolean => /^\d+\.0\.0-/.test(version);

/** Compares stable versions numerically, so 2.10.0 sorts after 2.9.0. */
function compareVersions(a: string, b: string): number {
	const [left, right] = [versionParts(a), versionParts(b)];
	for (let i = 0; i < 3; i++) {
		const difference = (left[i] ?? 0) - (right[i] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

/** The paths a release publishes to: an alias only when no newer stable release holds it, and a pre-release only its version, plus its major until that major has a stable release. */
export function schemaChannels(
	version: string,
	published: readonly string[] = []
): readonly string[] {
	if (isPrerelease(version)) {
		const major = majorOf(version);
		const majorIsStable = published.some(
			(other) => !isPrerelease(other) && majorOf(other) === major
		);
		return opensMajor(version) && !majorIsStable
			? [version, major]
			: [version];
	}

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
