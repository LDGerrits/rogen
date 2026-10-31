import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { withRelease } from "./changelog.js";

/** A file outside package.json that names the release. */
export interface VersionedFile {
	readonly path: string;
	/** Matches every version in the file, with the text before and after it. */
	readonly pattern: RegExp;
	/** The install docs keep pointing at the latest stable release while a pre-release is out, and follow pre-releases until there is one. */
	readonly stableOnly: boolean;
}

export const VERSIONED_FILES: readonly VersionedFile[] = [
	{
		path: "docs/content/docs/v2/installation.mdx",
		pattern: /(ldgerrits\/rogen@)(\d[^"]*)(")/g,
		stableOnly: true,
	},
	{
		path: "docs/components/home/install-command.tsx",
		pattern: /(ldgerrits\/rogen@)(\d[^"]*)(")/g,
		stableOnly: true,
	},
	{
		path: "README.md",
		pattern: /(ldgerrits\/rogen@)(\d[^\s`"]*)()/g,
		stableOnly: true,
	},
];

/**
 * Rewrites the files under `root` to name `version`, and returns the ones that changed.
 * @throws Error when a file no longer names a version, even one this release leaves alone, so a moved line stops the release instead of going stale.
 */
export function syncVersion(root: string, version: string): string[] {
	const prerelease = version.includes("-");
	const changed: string[] = [];
	for (const file of VERSIONED_FILES) {
		const target = path.join(root, file.path);
		const text = fs.readFileSync(target, "utf8");
		if (!text.match(file.pattern))
			throw new Error(`${file.path} no longer names a version.`);
		const pinsStable = [...text.matchAll(file.pattern)].every(
			(match) => !match[2].includes("-")
		);
		if (prerelease && file.stableOnly && pinsStable) continue;

		const next = text.replace(file.pattern, `$1${version}$3`);
		if (next === text) continue;
		fs.writeFileSync(target, next);
		changed.push(file.path);
	}
	return changed;
}

// `npm version` runs this between the bump and its commit, which takes what is staged.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const { version } = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
		version: string;
	};
	const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
	const released = withRelease(
		changelog,
		version,
		new Date().toISOString().slice(0, 10)
	);
	const changed = syncVersion(".", version);
	if (released !== changelog) {
		fs.writeFileSync("CHANGELOG.md", released);
		changed.push("CHANGELOG.md");
	}
	if (changed.length > 0) execFileSync("git", ["add", ...changed]);
	for (const file of changed) console.log(`Updated ${file} to ${version}`);
}
