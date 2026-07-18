import { jest } from "@jest/globals";
import { walkDirectory, IDirectoryReader } from "../walk.js";
import fs from "fs";
import { toPosix } from "../path.js";

describe("walkDirectory", () => {
	const srcPath = "src";
	const corePath = "src/core";

	const mockFsReader: IDirectoryReader = {
		readDir: jest.fn(async (dirPath: string): Promise<fs.Dirent[]> => {
			const normalizedPath = toPosix(dirPath);

			if (normalizedPath === srcPath) {
				return [
					{
						name: "core",
						isDirectory: () => true,
						isFile: () => false,
					} as fs.Dirent,
					{
						name: "main.ts",
						isDirectory: () => false,
						isFile: () => true,
					} as fs.Dirent,
				];
			}
			if (normalizedPath === corePath) {
				return [
					{
						name: "utils.ts",
						isDirectory: () => false,
						isFile: () => true,
					} as fs.Dirent,
				];
			}
			return [];
		}),
	};

	it("should map a directory tree recursively and normalize paths to POSIX", async () => {
		const listings = await walkDirectory(mockFsReader, srcPath);

		expect(listings.has(srcPath)).toBe(true);

		const normalizedKeys = Array.from(listings.keys()).map(toPosix);
		expect(normalizedKeys).toContain(corePath);

		const srcContents = listings.get(srcPath)!;
		expect(srcContents).toHaveLength(2);
		expect(srcContents[0].name).toBe("core");
	});

	it("should gracefully handle empty directories without crashing", async () => {
		const targetPath = `${corePath}/empty-folder`;
		const listings = await walkDirectory(mockFsReader, targetPath);
		const normalizedKeys = Array.from(listings.keys()).map(toPosix);

		expect(normalizedKeys).toContain(targetPath);
		expect(listings.get(targetPath)).toHaveLength(0);
	});

	it("should catch and return listings safely when hit with an ENOENT filesystem error", async () => {
		jest.spyOn(mockFsReader, "readDir").mockRejectedValueOnce(
			Object.assign(new Error("File not found"), { code: "ENOENT" })
		);

		const listings = await walkDirectory(mockFsReader, "missing-root");
		expect(listings.size).toBe(0);
	});
});
