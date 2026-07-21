import { MemoryFileSystemService } from "../memory-file-system-service.js";

describe("MemoryFileSystemService: core operations", () => {
	let memFs: MemoryFileSystemService;

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
	});

	it("should correctly identify files vs directories", async () => {
		await memFs.writeFile("src/app.ts", "content");
		await memFs.createDirectory("docs/api");

		expect(await memFs.isFile("src/app.ts")).toBe(true);
		expect(await memFs.isDirectory("src/app.ts")).toBe(false);

		expect(await memFs.isDirectory("docs/api")).toBe(true);
		expect(await memFs.isFile("docs/api")).toBe(false);

		expect(await memFs.exists("missing-file.ts")).toBe(false);
	});

	it("should throw EISDIR when attempting to read or write a directory as a file", async () => {
		await memFs.createDirectory("assets");

		await expect(memFs.readFile("assets")).rejects.toMatchObject({
			code: "EISDIR",
		});
		await expect(memFs.writeFile("assets", "data")).rejects.toMatchObject({
			code: "EISDIR",
		});
	});

	it("should throw ENOTDIR when trying to read a file as a directory", async () => {
		await memFs.writeFile("config.json", "{}");

		await expect(memFs.readDirectory("config.json")).rejects.toMatchObject({
			code: "ENOTDIR",
		});
	});

	it("should throw EISDIR when non-recursively deleting a directory", async () => {
		await memFs.createDirectory("temp");

		await expect(memFs.delete("temp", false)).rejects.toMatchObject({
			code: "EISDIR",
		});
	});

	it("should successfully overwrite files during copy only if overwrite is true", async () => {
		await memFs.writeFile("source.txt", "v1");
		await memFs.writeFile("dest.txt", "old");

		await expect(
			memFs.copy("source.txt", "dest.txt")
		).rejects.toMatchObject({ code: "EEXIST" });

		await memFs.copy("source.txt", "dest.txt", true);
		expect(await memFs.readFile("dest.txt")).toBe("v1");
	});

	it("should auto-create parent directories on writeFile", async () => {
		await memFs.writeFile("a/b/c/deep.txt", "hello");

		expect(await memFs.isDirectory("a/b/c")).toBe(true);
		expect(await memFs.exists("a/b/c/deep.txt")).toBe(true);
	});
});
