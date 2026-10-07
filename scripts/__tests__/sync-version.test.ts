import fs from "fs";
import os from "os";
import path from "path";
import {
	VERSIONED_FILES,
	VersionedFile,
	syncVersion,
	withVersion,
} from "../sync-version.js";

const [schemaFile, installFile] = VERSIONED_FILES;

describe("scripts/sync-version", () => {
	describe("withVersion", () => {
		it("should name the new version in the schema URL", () => {
			expect(
				withVersion(
					'export const SCHEMA_URL = schemaUrlFor("2.0.0-beta.1");',
					schemaFile,
					"2.0.0-beta.2"
				)
			).toBe('export const SCHEMA_URL = schemaUrlFor("2.0.0-beta.2");');
		});

		it("should name the new version in the Rokit pin", () => {
			expect(
				withVersion(
					'rogen = "ldgerrits/rogen@2.0.0"',
					installFile,
					"2.1.0"
				)
			).toBe('rogen = "ldgerrits/rogen@2.1.0"');
		});

		it("should throw when the file no longer names a version", () => {
			expect(() =>
				withVersion(
					"export const SCHEMA_URL = URL;",
					schemaFile,
					"2.1.0"
				)
			).toThrow(schemaFile.path);
		});
	});

	describe("syncVersion", () => {
		let root: string;

		beforeEach(() => {
			root = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-version-"));
			const write = (file: string, text: string) => {
				fs.mkdirSync(path.dirname(path.join(root, file)), {
					recursive: true,
				});
				fs.writeFileSync(path.join(root, file), text);
			};
			write(
				schemaFile.path,
				'export const SCHEMA_URL = schemaUrlFor("2.0.0");\n'
			);
			write(installFile.path, 'rogen = "ldgerrits/rogen@2.0.0"\n');
		});

		afterEach(() => {
			fs.rmSync(root, { recursive: true, force: true });
		});

		const read = (file: VersionedFile) =>
			fs.readFileSync(path.join(root, file.path), "utf8");

		it("should move every file to a stable release", () => {
			expect(syncVersion(root, "2.1.0")).toEqual(
				VERSIONED_FILES.map((file) => file.path)
			);
			expect(read(schemaFile)).toContain('schemaUrlFor("2.1.0")');
			expect(read(installFile)).toContain("ldgerrits/rogen@2.1.0");
		});

		it("should keep the install docs on the stable release for a pre-release", () => {
			expect(syncVersion(root, "2.1.0-beta.1")).toEqual([
				schemaFile.path,
			]);
			expect(read(schemaFile)).toContain('schemaUrlFor("2.1.0-beta.1")');
			expect(read(installFile)).toContain("ldgerrits/rogen@2.0.0");
		});

		it("should report no files when they already name the version", () => {
			expect(syncVersion(root, "2.0.0")).toEqual([]);
		});
	});

	describe("VERSIONED_FILES", () => {
		it("should each still name a version in the repo", () => {
			for (const file of VERSIONED_FILES)
				expect(
					file.pattern.test(fs.readFileSync(file.path, "utf8"))
				).toBe(true);
		});
	});
});
