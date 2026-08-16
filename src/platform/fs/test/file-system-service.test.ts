import { jest } from "@jest/globals";
import { MemoryFileSystemService } from "../memory-file-system-service.js";
import { FileType } from "../file-system-service.js";
import { FileChangeType } from "../../watcher/files.js";

describe("MemoryFileSystemService: core operations", () => {
	let memFs: MemoryFileSystemService;

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
	});

	describe("File and Directory Identification", () => {
		it("should correctly identify files vs directories", async () => {
			await memFs.writeFile("src/app.ts", "content");
			await memFs.createDirectory("docs/api");

			expect(await memFs.isFile("src/app.ts")).toBe(true);
			expect(await memFs.isDirectory("src/app.ts")).toBe(false);

			expect(await memFs.isDirectory("docs/api")).toBe(true);
			expect(await memFs.isFile("docs/api")).toBe(false);

			expect(await memFs.exists("missing-file.ts")).toBe(false);
		});
	});

	describe("Reads and Writes", () => {
		it("should auto-create parent directories on writeFile", async () => {
			await memFs.writeFile("a/b/c/deep.txt", "hello");

			expect(await memFs.isDirectory("a/b/c")).toBe(true);
			expect(await memFs.exists("a/b/c/deep.txt")).toBe(true);
		});

		it("should return the contents of a directory with correct FileTypes", async () => {
			await memFs.writeFile("src/index.ts", "");
			await memFs.createDirectory("src/components");

			const entries = await memFs.readDirectory("src");
			expect(entries).toHaveLength(2);
			expect(entries).toContainEqual(["index.ts", FileType.File]);
			expect(entries).toContainEqual(["components", FileType.Directory]);
		});

		it("should parse and return JSON from readJson", async () => {
			await memFs.writeFile(
				"config.json",
				JSON.stringify({ key: "value" })
			);
			const data = await memFs.readJson<{ key: string }>("config.json");
			expect(data.key).toBe("value");
		});

		it("should successfully copy a file to a new destination", async () => {
			await memFs.writeFile("src.txt", "data");
			await memFs.copy("src.txt", "dest.txt");
			expect(await memFs.readFile("dest.txt")).toBe("data");
		});
	});

	describe("Deletions", () => {
		it("should successfully delete a single file", async () => {
			await memFs.writeFile("temp.txt", "data");
			await memFs.delete("temp.txt");
			expect(await memFs.exists("temp.txt")).toBe(false);
		});

		it("should recursively delete a directory and all its contents", async () => {
			await memFs.writeFile("dist/js/app.js", "code");
			await memFs.writeFile("dist/index.html", "html");

			await memFs.delete("dist", true);

			expect(await memFs.exists("dist")).toBe(false);
			expect(await memFs.exists("dist/js/app.js")).toBe(false);
		});

		it("should fail gracefully (no-op) when deleting a non-existent file", async () => {
			await expect(
				memFs.delete("does-not-exist.txt")
			).resolves.not.toThrow();
		});
	});

	describe("Error Handling", () => {
		it("should throw EISDIR when attempting to read or write a directory as a file", async () => {
			await memFs.createDirectory("assets");

			await expect(memFs.readFile("assets")).rejects.toMatchObject({
				code: "EISDIR",
			});
			await expect(
				memFs.writeFile("assets", "data")
			).rejects.toMatchObject({
				code: "EISDIR",
			});
		});

		it("should throw ENOTDIR when trying to read a file as a directory", async () => {
			await memFs.writeFile("config.json", "{}");

			await expect(
				memFs.readDirectory("config.json")
			).rejects.toMatchObject({
				code: "ENOTDIR",
			});
		});

		it("should throw ENOTDIR when writing a file where a parent in the path is actually a file", async () => {
			await memFs.writeFile("src/file.ts", "data");
			await expect(
				memFs.writeFile("src/file.ts/nested.ts", "data")
			).rejects.toMatchObject({
				code: "ENOTDIR",
			});
		});

		it("should throw EISDIR when non-recursively deleting a directory", async () => {
			await memFs.createDirectory("temp");

			await expect(memFs.delete("temp", false)).rejects.toMatchObject({
				code: "EISDIR",
			});
		});

		it("should throw EEXIST when creating a directory where a file already exists", async () => {
			await memFs.writeFile("file.txt", "content");
			await expect(
				memFs.createDirectory("file.txt")
			).rejects.toMatchObject({
				code: "EEXIST",
			});
		});

		it("should throw EEXIST when overwriting files during copy only if overwrite is false", async () => {
			await memFs.writeFile("source.txt", "v1");
			await memFs.writeFile("dest.txt", "old");

			await expect(
				memFs.copy("source.txt", "dest.txt")
			).rejects.toMatchObject({ code: "EEXIST" });

			await memFs.copy("source.txt", "dest.txt", true);
			expect(await memFs.readFile("dest.txt")).toBe("v1");
		});

		it("should throw ENOENT when reading a non-existent file", async () => {
			await expect(memFs.readFile("missing.txt")).rejects.toMatchObject({
				code: "ENOENT",
			});
		});
	});

	describe("Events (onDidMutateFile)", () => {
		it("should emit ADDED and UPDATED events correctly for files and directories", async () => {
			const listener = jest.fn();
			memFs.onDidMutateFile(listener);

			await memFs.createDirectory("src");
			expect(listener).toHaveBeenCalledWith({
				type: FileChangeType.ADDED,
				path: "src",
				fileType: FileType.Directory,
			});

			await memFs.writeFile("src/app.ts", "v1");
			expect(listener).toHaveBeenCalledWith({
				type: FileChangeType.ADDED,
				path: "src/app.ts",
				fileType: FileType.File,
			});

			await memFs.writeFile("src/app.ts", "v2");
			expect(listener).toHaveBeenCalledWith({
				type: FileChangeType.UPDATED,
				path: "src/app.ts",
				fileType: FileType.File,
			});
		});

		it("should emit DELETED events recursively when a directory is deleted", async () => {
			await memFs.writeFile("docs/api/index.md", "");

			const listener = jest.fn();
			memFs.onDidMutateFile(listener);

			await memFs.delete("docs", true);

			expect(listener).toHaveBeenCalledWith({
				type: FileChangeType.DELETED,
				path: "docs/api/index.md",
				fileType: FileType.File,
			});
			expect(listener).toHaveBeenCalledWith({
				type: FileChangeType.DELETED,
				path: "docs/api",
				fileType: FileType.Directory,
			});
			expect(listener).toHaveBeenCalledWith({
				type: FileChangeType.DELETED,
				path: "docs",
				fileType: FileType.Directory,
			});
		});
	});
});
