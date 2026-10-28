import fs from "fs";
import { pathToFileURL } from "url";

const UNRELEASED = "## Unreleased";
const RELEASES = "https://github.com/LDGerrits/rogen/releases/tag/";

const linesOf = (changelog: string): string[] => changelog.split(/\r?\n/);

/** The line of the first `## ` heading after `start`, or the end. */
const nextHeading = (lines: readonly string[], start: number): number => {
	const found = lines.findIndex(
		(line, index) => index > start && line.startsWith("## ")
	);
	return found === -1 ? lines.length : found;
};

/** What the changelog says under `version`, without its heading and link; undefined when it says nothing. */
export function releaseNotes(
	changelog: string,
	version: string
): string | undefined {
	const lines = linesOf(changelog);
	const heading = lines.findIndex((line) =>
		line.startsWith(`## [${version}]`)
	);
	if (heading === -1) return undefined;
	const notes = lines
		.slice(heading + 1, nextHeading(lines, heading))
		.filter((line) => !line.startsWith(`[${version}]: `))
		.join("\n")
		.trim();
	return notes === "" ? undefined : notes;
}

/**
 * The changelog with the notes under Unreleased moved under a heading for `version`, released on `date`.
 * @throws Error when the changelog has notes for neither, so a release can't go out without them.
 */
export function withRelease(
	changelog: string,
	version: string,
	date: string
): string {
	if (releaseNotes(changelog, version) !== undefined) return changelog;
	const lines = linesOf(changelog);
	const unreleased = lines.indexOf(UNRELEASED);
	const end = nextHeading(lines, unreleased);
	const notes =
		unreleased === -1
			? ""
			: lines
					.slice(unreleased + 1, end)
					.join("\n")
					.trim();
	if (notes === "")
		throw new Error(
			`CHANGELOG.md has no notes for ${version}: write them under "${UNRELEASED}".`
		);
	return [
		...lines.slice(0, unreleased + 1),
		"",
		`## [${version}] - ${date}`,
		"",
		notes,
		"",
		`[${version}]: ${RELEASES}v${version}`,
		"",
		...lines.slice(end),
	].join("\n");
}

// The release workflow takes a tag's notes from here: `node scripts/changelog.ts <version>`.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const version = process.argv[2] ?? "";
	const notes = releaseNotes(
		fs.readFileSync("CHANGELOG.md", "utf8"),
		version
	);
	if (notes === undefined) {
		console.error(`CHANGELOG.md has no notes for ${version}.`);
		process.exit(1);
	}
	console.log(notes);
}
