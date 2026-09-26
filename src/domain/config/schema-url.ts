export const SCHEMA_BASE_URL = "https://ldgerrits.github.io/rogen/schema";

export const isPrerelease = (version: string): boolean => version.includes("-");

const majorOf = (version: string): string => version.split(".")[0];

/** Pre-releases publish only their exact version so a breaking change can't reach stable users. */
export function schemaChannels(version: string): readonly string[] {
	return isPrerelease(version)
		? [version]
		: [version, majorOf(version), "latest"];
}

export function schemaUrlFor(version: string): string {
	const channel = isPrerelease(version) ? version : majorOf(version);
	return `${SCHEMA_BASE_URL}/${channel}/rogen.json`;
}
