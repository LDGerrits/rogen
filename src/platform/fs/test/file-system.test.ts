import { jest } from "@jest/globals";
import { FileType } from "../file-system-service.js";
import { MemoryFileSystemService } from "../memory-file-system-service.js";
import { walkDirectory } from "../walk.js";

describe("FileSystemService: walkDirectory", () => {
	let memFs: MemoryFileSystemService;

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
	});

	it("should map a directory tree recursively and structure the listings map", async () => {
		const srcPath = "src";
		const corePath = "src/core";

		await memFs.writeFile("src/main.ts", "console.log('init');");
		await memFs.writeFile("src/core/utils.ts", "export const x = 1;");

		const listings = await walkDirectory(memFs, srcPath);

		expect(listings.has(srcPath)).toBe(true);
		expect(listings.has(corePath)).toBe(true);

		const srcContents = listings.get(srcPath)!;
		expect(srcContents).toHaveLength(2);

		expect(srcContents).toContainEqual(["core", FileType.Directory]);
		expect(srcContents).toContainEqual(["main.ts", FileType.File]);

		const coreContents = listings.get(corePath)!;
		expect(coreContents).toHaveLength(1);
		expect(coreContents).toContainEqual(["utils.ts", FileType.File]);
	});

	it("should gracefully handle empty or nonexistent directories without crashing", async () => {
		const targetPath = "src/core/empty-folder";

		const listings = await walkDirectory(memFs, targetPath);

		expect(listings.has(targetPath)).toBe(true);
		expect(listings.get(targetPath)).toHaveLength(0);
	});

	it("should catch and return listings safely when hit with an ENOENT filesystem error", async () => {
		jest.spyOn(memFs, "readDirectory").mockRejectedValueOnce(
			Object.assign(new Error("File not found"), { code: "ENOENT" })
		);

		const listings = await walkDirectory(memFs, "missing-root");
		expect(listings.size).toBe(0);
	});
});
