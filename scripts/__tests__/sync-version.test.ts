import fs from "fs";
import os from "os";
import path from "path";
import { VERSIONED_FILES, syncVersion } from "../sync-version.js";

const SCHEMA_FILE = "src/domain/config/config.ts";
const INSTALL_FILE = "docs/content/docs/v2/installation.mdx";
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

describe("scripts/sync-version", () => {
	describe("syncVersion", () => {
		let root: string;

		const write = (file: string, text: string) => {
			fs.mkdirSync(path.dirname(path.join(root, file)), {
				recursive: true,
			});
			fs.writeFileSync(path.join(root, file), text);
		};
		const read = (file: string) =>
			fs.readFileSync(path.join(root, file), "utf8");

		beforeEach(() => {
			root = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-version-"));
			write(
				SCHEMA_FILE,
				'export const SCHEMA_URL = schemaUrlFor("2.0.0");\n'
			);
			write(INSTALL_FILE, 'rogen = "ldgerrits/rogen@2.0.0"\n');
		});

		afterEach(() => {
			fs.rmSync(root, { recursive: true, force: true });
		});

		it("should move every file to a stable release", () => {
			expect(syncVersion(root, "2.1.0")).toEqual([
				SCHEMA_FILE,
				INSTALL_FILE,
			]);
			expect(read(SCHEMA_FILE)).toBe(
				'export const SCHEMA_URL = schemaUrlFor("2.1.0");\n'
			);
			expect(read(INSTALL_FILE)).toBe(
				'rogen = "ldgerrits/rogen@2.1.0"\n'
			);
		});

		it("should keep the install docs on the stable release for a pre-release", () => {
			expect(syncVersion(root, "2.1.0-beta.1")).toEqual([SCHEMA_FILE]);
			expect(read(SCHEMA_FILE)).toContain('schemaUrlFor("2.1.0-beta.1")');
			expect(read(INSTALL_FILE)).toContain("ldgerrits/rogen@2.0.0");
		});

		it("should move every version a file names", () => {
			write(
				INSTALL_FILE,
				'rogen = "ldgerrits/rogen@2.0.0"\nrogen = "ldgerrits/rogen@2.0.0"\n'
			);
			syncVersion(root, "2.1.0");
			expect(read(INSTALL_FILE)).not.toContain("@2.0.0");
		});

		it("should report no files when they already name the version", () => {
			expect(syncVersion(root, "2.0.0")).toEqual([]);
		});

		it("should throw when a file no longer names a version", () => {
			write(SCHEMA_FILE, "export const SCHEMA_URL = URL;\n");
			expect(() => syncVersion(root, "2.1.0")).toThrow(SCHEMA_FILE);
		});

		it("should throw for a pre-release when a file it leaves alone no longer names a version", () => {
			write(INSTALL_FILE, "rokit add ldgerrits/rogen\n");
			expect(() => syncVersion(root, "2.1.0-beta.1")).toThrow(
				INSTALL_FILE
			);
		});
	});

	describe("VERSIONED_FILES", () => {
		it("should each still name a version in the repo", () => {
			for (const file of VERSIONED_FILES)
				expect(
					fs.readFileSync(path.join(REPO_ROOT, file.path), "utf8")
				).toMatch(file.pattern);
		});
	});
});
