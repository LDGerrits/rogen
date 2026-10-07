import { schemaChannel } from "../src/domain/config/config.js";

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

/** The paths a release publishes to; an alias moves only while no newer stable release holds it. */
export function schemaChannels(
	version: string,
	published: readonly string[] = []
): readonly string[] {
	const stable = published.filter((other) => !isPrerelease(other));
	const major = majorOf(version);
	if (isPrerelease(version)) {
		const channel = schemaChannel(version);
		const exactOnly =
			channel === version ||
			stable.some((other) => majorOf(other) === major);
		return exactOnly ? [version] : [version, channel];
	}

	const newer = stable.filter((other) => compareVersions(other, version) > 0);
	return [
		version,
		...(newer.some((other) => majorOf(other) === major) ? [] : [major]),
		...(newer.length > 0 ? [] : ["latest"]),
	];
}
