import { jest } from "@jest/globals";
import { MemoryFileSystemService } from "../memory-file-system-service.js";
import {
	FileType,
	failureReason,
	fileSystemError,
	isMissingPath,
} from "../file-system-service.js";
import { FileChange, FileChangeType } from "../file-changes.js";

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
	});

	describe("Renames", () => {
		it("should emit DELETED for the source and UPDATED for a replaced destination", async () => {
			await memFs.writeFile("a.txt", "new");
			await memFs.writeFile("b.txt", "old");
			const listener = jest.fn();
			memFs.onDidMutateFile(listener);

			await memFs.rename("a.txt", "b.txt", true);

			expect(listener).toHaveBeenCalledWith({
				type: FileChangeType.DELETED,
				path: "a.txt",
				fileType: FileType.File,
			});
			expect(listener).toHaveBeenCalledWith({
				type: FileChangeType.UPDATED,
				path: "b.txt",
				fileType: FileType.File,
			});
		});
	});

	describe("Deletions", () => {
		it("should recursively delete a directory and all its contents", async () => {
			await memFs.writeFile("dist/js/app.js", "code");
			await memFs.writeFile("dist/index.html", "html");

			await memFs.delete("dist", true);

			expect(await memFs.exists("dist")).toBe(false);
			expect(await memFs.exists("dist/js/app.js")).toBe(false);
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

	describe("Symbolic links: events", () => {
		const collect = () => {
			const changes: FileChange[] = [];
			memFs.onDidMutateFile((change) => changes.push(change));
			return changes;
		};

		it("should report a new link and everything under it as added", async () => {
			await memFs.writeFile("shared/a.luau", "");
			const changes = collect();

			await memFs.createSymbolicLink("shared", "src/Shared");

			expect(changes).toEqual([
				{
					type: FileChangeType.ADDED,
					path: "src/Shared",
					fileType: FileType.Directory,
				},
				{
					type: FileChangeType.ADDED,
					path: "src/Shared/a.luau",
					fileType: FileType.File,
				},
			]);
		});

		it("should report a write to a target under the link path as well", async () => {
			await memFs.writeFile("shared/a.luau", "");
			await memFs.createSymbolicLink("shared", "src/Shared");
			const changes = collect();

			await memFs.writeFile("shared/a.luau", "v2");

			expect(changes.map((change) => change.path)).toEqual([
				"shared/a.luau",
				"src/Shared/a.luau",
			]);
		});

		it("should report a write through a link as a write to the target", async () => {
			await memFs.writeFile("shared/a.luau", "");
			await memFs.createSymbolicLink("shared", "src/Shared");
			const changes = collect();

			await memFs.writeFile("src/Shared/a.luau", "v2");

			expect(changes.map((change) => change.path)).toEqual([
				"shared/a.luau",
				"src/Shared/a.luau",
			]);
			expect(await memFs.readFile("shared/a.luau")).toBe("v2");
		});

		it("should report a deleted link and what was under it, and keep the target", async () => {
			await memFs.writeFile("shared/a.luau", "");
			await memFs.createSymbolicLink("shared", "src/Shared");
			const changes = collect();

			await memFs.delete("src/Shared", true);

			expect(changes.map((change) => change.path)).toEqual([
				"src/Shared/a.luau",
				"src/Shared",
			]);
			expect(
				changes.every((c) => c.type === FileChangeType.DELETED)
			).toBe(true);
			expect(await memFs.exists("shared/a.luau")).toBe(true);
		});

		it("should stop reporting under a link that points at its own parent", async () => {
			await memFs.writeFile("src/a.luau", "");
			const changes = collect();

			await memFs.createSymbolicLink("src", "src/Loop");
			await memFs.writeFile("src/a.luau", "v2");

			expect(changes.map((change) => change.path)).toEqual([
				"src/Loop",
				"src/Loop/a.luau",
				"src/Loop/Loop",
				"src/a.luau",
				"src/Loop/a.luau",
			]);
		});
	});
});

describe("file system failures", () => {
	it("should tell a missing path by its code and not its message", () => {
		expect(isMissingPath(fileSystemError("ENOENT", "gone"))).toBe(true);
		expect(
			isMissingPath(fileSystemError("EISDIR", "ENOENT: not really"))
		).toBe(false);
		expect(isMissingPath(new Error("ENOENT"))).toBe(false);
	});

	it.each([
		[
			"ENOENT: no such file or directory, open '/x'",
			"no such file or directory",
		],
		["EACCES: permission denied, open '/x'", "permission denied"],
		[
			"EISDIR: illegal operation on a directory, read",
			"illegal operation on a directory",
		],
		[
			"EISDIR: illegal operation on a directory, read '/x'",
			"illegal operation on a directory",
		],
		["disk full", "disk full"],
	])("should give the reason of %j without its code", (message, reason) => {
		expect(failureReason(new Error(message))).toBe(reason);
	});

	it("should give the reason a memory file system fails with when a directory is read as a file", async () => {
		const memFs = new MemoryFileSystemService();
		await memFs.createDirectory("/repo/dir");

		const error = await memFs.readFile("/repo/dir").catch((e: Error) => e);

		expect(failureReason(error as Error)).toBe(
			"illegal operation on a directory"
		);
		expect((error as { code?: string }).code).toBe("EISDIR");
	});
});
