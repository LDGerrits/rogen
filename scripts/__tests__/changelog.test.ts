import fs from "fs";
import path from "path";
import { releaseNotes, withRelease } from "../changelog.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const COMPARE = "https://github.com/LDGerrits/rogen/compare/";

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- A new flag.

## [2.0.0] - 2026-01-01

### Fixed

- A fix.

## [2.0.0-beta.1] - 2025-12-01

### Added

- A beta.

[unreleased]: ${COMPARE}v2.0.0...HEAD
[2.0.0]: ${COMPARE}v2.0.0-beta.1...v2.0.0
[2.0.0-beta.1]: https://github.com/LDGerrits/rogen/releases/tag/v2.0.0-beta.1
`;

describe("scripts/changelog", () => {
	describe("releaseNotes", () => {
		it("should return the notes under a version without its heading", () => {
			expect(releaseNotes(CHANGELOG, "2.0.0")).toBe(
				"### Fixed\n\n- A fix."
			);
		});

		it("should leave out the link definitions after the last version", () => {
			expect(releaseNotes(CHANGELOG, "2.0.0-beta.1")).toBe(
				"### Added\n\n- A beta."
			);
		});

		it("should read a changelog with Windows line endings", () => {
			expect(
				releaseNotes(CHANGELOG.replaceAll("\n", "\r\n"), "2.0.0")
			).toBe("### Fixed\n\n- A fix.");
		});

		it("should return undefined for a version the changelog doesn't name", () => {
			expect(releaseNotes(CHANGELOG, "2.1.0")).toBeUndefined();
		});

		it("should return undefined for a version with an empty section", () => {
			expect(
				releaseNotes("## [2.1.0] - 2026-02-01\n\n## [2.0.0]\n", "2.1.0")
			).toBeUndefined();
		});
	});

	describe("withRelease", () => {
		it("should move the unreleased notes under a dated heading", () => {
			const released = withRelease(CHANGELOG, "2.1.0", "2026-02-01");

			expect(released).toContain(
				"## [Unreleased]\n\n## [2.1.0] - 2026-02-01\n\n### Added\n\n- A new flag.\n\n## [2.0.0] - 2026-01-01"
			);
			expect(releaseNotes(released, "2.1.0")).toBe(
				"### Added\n\n- A new flag."
			);
		});

		it("should compare the new version with the last one and Unreleased with it", () => {
			const released = withRelease(CHANGELOG, "2.1.0", "2026-02-01");

			expect(released).toContain(
				`[unreleased]: ${COMPARE}v2.1.0...HEAD\n[2.1.0]: ${COMPARE}v2.0.0...v2.1.0\n[2.0.0]: `
			);
		});

		it("should keep the link definitions when Unreleased is the only section", () => {
			const released = withRelease(
				`## [Unreleased]\n\n- A change.\n\n[unreleased]: ${COMPARE}v1.0.0...HEAD\n`,
				"1.1.0",
				"2026-02-01"
			);

			expect(released).toBe(
				`## [Unreleased]\n\n## [1.1.0] - 2026-02-01\n\n- A change.\n\n[unreleased]: ${COMPARE}v1.1.0...HEAD\n[1.1.0]: ${COMPARE}v1.0.0...v1.1.0\n`
			);
		});

		it("should leave a changelog that already has notes for the version", () => {
			expect(withRelease(CHANGELOG, "2.0.0", "2026-02-01")).toBe(
				CHANGELOG
			);
		});

		it("should throw when Unreleased holds no notes", () => {
			const empty = CHANGELOG.replace(
				"### Added\n\n- A new flag.\n\n",
				""
			);

			expect(() => withRelease(empty, "2.1.0", "2026-02-01")).toThrow(
				"2.1.0"
			);
		});

		it("should throw when the changelog has no Unreleased heading", () => {
			expect(() =>
				withRelease("# Changelog\n", "2.1.0", "2026-02-01")
			).toThrow("2.1.0");
		});

		it("should throw when the changelog has no unreleased link", () => {
			expect(() =>
				withRelease(
					"## [Unreleased]\n\n- A change.\n",
					"2.1.0",
					"2026-02-01"
				)
			).toThrow("[unreleased]");
		});
	});

	describe("CHANGELOG.md", () => {
		const changelog = fs.readFileSync(
			path.join(REPO_ROOT, "CHANGELOG.md"),
			"utf8"
		);

		it("should have notes for the version in package.json", () => {
			const { version } = JSON.parse(
				fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
			) as { version: string };

			expect(releaseNotes(changelog, version)).toBeDefined();
		});

		it("should have a link for every version it lists", () => {
			const versions = [...changelog.matchAll(/^## \[(.+?)\]/gm)].map(
				([, version]) => version.toLowerCase()
			);
			const links = [...changelog.matchAll(/^\[(.+?)\]: /gm)].map(
				([, version]) => version.toLowerCase()
			);

			expect(links).toEqual(versions);
		});

		it("should group every change under a type of change", () => {
			const groups = [...changelog.matchAll(/^### (.+)$/gm)].map(
				([, group]) => group
			);

			expect(
				groups.filter(
					(group) =>
						![
							"Added",
							"Changed",
							"Deprecated",
							"Removed",
							"Fixed",
							"Security",
						].includes(group)
				)
			).toEqual([]);
		});
	});
});
