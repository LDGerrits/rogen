import fs from "fs";
import { pathToFileURL } from "url";

const UNRELEASED = "## [Unreleased]";
const COMPARE = "https://github.com/LDGerrits/rogen/compare/";
const UNRELEASED_LINK = /^\[unreleased\]: .*\/compare\/v(.+)\.\.\.HEAD$/i;
const LINK_DEFINITION = /^\[[^\]]+\]: \S+$/;

const linesOf = (changelog: string): string[] => changelog.split(/\r?\n/);

/** The line of the first `## ` heading after `start`, or the end. */
const nextHeading = (lines: readonly string[], start: number): number => {
	const found = lines.findIndex(
		(line, index) => index > start && line.startsWith("## ")
	);
	return found === -1 ? lines.length : found;
};

/** What the changelog says under `version`, without its heading; undefined when it says nothing. */
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
		.filter((line) => !LINK_DEFINITION.test(line))
		.join("\n")
		.trim();
	return notes === "" ? undefined : notes;
}

/**
 * The changelog with the notes under Unreleased moved under a heading for `version`, released on `date`, and its compare links moved on.
 * @throws Error when the changelog has notes for neither, or no `[unreleased]` compare link, so a release can't go out without them.
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
	const section = unreleased === -1 ? [] : lines.slice(unreleased + 1, end);
	const notes = section
		.filter((line) => !LINK_DEFINITION.test(line))
		.join("\n")
		.trim();
	if (notes === "")
		throw new Error(
			`CHANGELOG.md has no notes for ${version}: write them under "${UNRELEASED}".`
		);
	if (!lines.some((line) => UNRELEASED_LINK.test(line)))
		throw new Error(
			"CHANGELOG.md has no [unreleased] link comparing the last release with HEAD."
		);
	const withLinks = (part: readonly string[]): string[] =>
		part.flatMap((line) => {
			const previous = UNRELEASED_LINK.exec(line)?.[1];
			return previous === undefined
				? [line]
				: [
						`[unreleased]: ${COMPARE}v${version}...HEAD`,
						`[${version}]: ${COMPARE}v${previous}...v${version}`,
					];
		});
	return [
		...lines.slice(0, unreleased + 1),
		"",
		`## [${version}] - ${date}`,
		"",
		notes,
		"",
		...withLinks(section.filter((line) => LINK_DEFINITION.test(line))),
		...(end === lines.length ? [""] : withLinks(lines.slice(end))),
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
