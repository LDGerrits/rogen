import fs from "fs";
import path from "path";
import { releaseNotes, withRelease } from "../changelog.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const CHANGELOG = `# Changelog

## Unreleased

- **Watching:** A new change.

## [2.0.0] - 2026-01-01

The first release.

### Fixes

- A fix.

[2.0.0]: https://github.com/LDGerrits/rogen/releases/tag/v2.0.0

## [2.0.0-beta.1] - 2025-12-01

- A beta.
`;

describe("scripts/changelog", () => {
	describe("releaseNotes", () => {
		it("should return the notes under a version without its heading and link", () => {
			expect(releaseNotes(CHANGELOG, "2.0.0")).toBe(
				"The first release.\n\n### Fixes\n\n- A fix."
			);
		});

		it("should not take a pre-release for the release it leads to", () => {
			expect(releaseNotes(CHANGELOG, "2.0.0-beta.1")).toBe("- A beta.");
		});

		it("should read a changelog with Windows line endings", () => {
			expect(
				releaseNotes(CHANGELOG.replaceAll("\n", "\r\n"), "2.0.0-beta.1")
			).toBe("- A beta.");
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
		it("should move the unreleased notes under a dated heading with its link", () => {
			const released = withRelease(CHANGELOG, "2.1.0", "2026-02-01");

			expect(released).toContain(
				"## Unreleased\n\n## [2.1.0] - 2026-02-01\n\n- **Watching:** A new change.\n\n[2.1.0]: https://github.com/LDGerrits/rogen/releases/tag/v2.1.0\n\n## [2.0.0] - 2026-01-01"
			);
			expect(releaseNotes(released, "2.1.0")).toBe(
				"- **Watching:** A new change."
			);
		});

		it("should release the notes when Unreleased is the last section", () => {
			const released = withRelease(
				"## Unreleased\n\n- A change.\n",
				"2.1.0",
				"2026-02-01"
			);

			expect(released).toBe(
				"## Unreleased\n\n## [2.1.0] - 2026-02-01\n\n- A change.\n\n[2.1.0]: https://github.com/LDGerrits/rogen/releases/tag/v2.1.0\n"
			);
		});

		it("should leave a changelog that already has notes for the version", () => {
			expect(withRelease(CHANGELOG, "2.0.0", "2026-02-01")).toBe(
				CHANGELOG
			);
		});

		it("should throw when Unreleased holds no notes", () => {
			const empty = CHANGELOG.replace(
				"- **Watching:** A new change.\n\n",
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
	});

	describe("CHANGELOG.md", () => {
		it("should have notes for the version in package.json", () => {
			const { version } = JSON.parse(
				fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
			) as { version: string };

			expect(
				releaseNotes(
					fs.readFileSync(
						path.join(REPO_ROOT, "CHANGELOG.md"),
						"utf8"
					),
					version
				)
			).toBeDefined();
		});
	});
});
