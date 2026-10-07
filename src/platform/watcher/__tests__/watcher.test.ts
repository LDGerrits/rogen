import { jest } from "@jest/globals";
import { MemoryWatcher } from "../memory-watcher.js";
import { isIgnored } from "../watcher.js";
import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";
import { FileType } from "../../fs/file-system-service.js";
import { NullLogService } from "../../log/null-log-service.js";
import { FileChangeType } from "../../fs/file-changes.js";

describe("MemoryWatcher", () => {
	let memoryFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let logService: NullLogService;

	beforeEach(() => {
		memoryFs = new MemoryFileSystemService();
		logService = new NullLogService();
		watcher = new MemoryWatcher(memoryFs, logService);
	});

	afterEach(async () => {
		await watcher.stop();
	});

	it("should stop reporting once disposed", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);
		await watcher.watch(["src"]);

		watcher[Symbol.dispose]();
		await memoryFs.writeFile("src/init.lua", "");

		expect(listener).not.toHaveBeenCalled();
	});

	it("should emit ADDED and UPDATED events immediately without batching", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await memoryFs.createDirectory("src");
		await watcher.watch(["src"]);

		await memoryFs.writeFile("src/init.lua", "-- added");
		await memoryFs.writeFile("src/init.lua", "-- updated");

		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenNthCalledWith(1, [
			{
				type: FileChangeType.ADDED,
				path: "src/init.lua",
				fileType: FileType.File,
			},
		]);
		expect(listener).toHaveBeenNthCalledWith(2, [
			{
				type: FileChangeType.UPDATED,
				path: "src/init.lua",
				fileType: FileType.File,
			},
		]);
	});

	it("should catch multiple DELETED events with accurate fileTypes when a directory is removed recursively", async () => {
		const listener = jest.fn();

		await memoryFs.writeFile("src/components/button.lua", "");
		await memoryFs.writeFile("src/components/card.lua", "");

		watcher.onDidChangeFile(listener);
		await watcher.watch(["src"]);

		await memoryFs.delete("src/components", true);

		expect(listener).toHaveBeenCalledTimes(3);
		expect(listener).toHaveBeenCalledWith([
			{
				type: FileChangeType.DELETED,
				path: "src/components/button.lua",
				fileType: FileType.File,
			},
		]);
		expect(listener).toHaveBeenCalledWith([
			{
				type: FileChangeType.DELETED,
				path: "src/components/card.lua",
				fileType: FileType.File,
			},
		]);
		expect(listener).toHaveBeenCalledWith([
			{
				type: FileChangeType.DELETED,
				path: "src/components",
				fileType: FileType.Directory,
			},
		]);
	});

	it("should report only a watched file's own changes", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch(["package.json"]);
		await memoryFs.writeFile("package.json", "{}");

		expect(listener).toHaveBeenCalledTimes(1);

		listener.mockClear();

		await memoryFs.writeFile("package-lock.json", "{}");
		await memoryFs.writeFile("ignored-folder/fake-nested.txt", "...");

		expect(listener).toHaveBeenCalledTimes(0);
	});

	it("should handle multiple active watch paths simultaneously", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await memoryFs.createDirectory("src");
		await memoryFs.createDirectory("tests");
		await watcher.watch([
			"src",
			"tests",
		]);

		await memoryFs.writeFile("src/main.ts", "");
		await memoryFs.writeFile("tests/main.test.ts", "");
		await memoryFs.writeFile("ignored/other.ts", "");

		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("should gracefully stop emitting events after stop() is called", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch(["src"]);
		await watcher.stop();

		await memoryFs.writeFile("src/should-be-ignored.ts", "");

		expect(listener).not.toHaveBeenCalled();
	});

	it("should skip a file and everything under a directory it was told to ignore", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await memoryFs.createDirectory("src");
		await watcher.watch(["src"], {
			ignored: ["src/out", "src/a.project.json"],
		});

		await memoryFs.writeFile("src/out/nested/A.luau", "");
		await memoryFs.writeFile("src/a.project.json", "");
		await memoryFs.writeFile("src/out-of-tree.luau", "");

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should skip a path that matches an ignored pattern", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await memoryFs.createDirectory("src");
		await watcher.watch(["src"], {
			ignored: [/^src\/a\.project\.json\.[^/]+\.tmp$/],
		});

		await memoryFs.writeFile("src/a.project.json.abc.tmp", "");
		await memoryFs.writeFile("src/a.project.json", "");

		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe("isIgnored", () => {
	it("should match the ignored path itself", () => {
		expect(isIgnored("/repo/out", ["/repo/out"])).toBe(true);
	});

	it("should match a path under an ignored directory", () => {
		expect(isIgnored("/repo/out/a/B.luau", ["/repo/out"])).toBe(true);
	});

	it("should not match a sibling that shares a name prefix", () => {
		expect(isIgnored("/repo/out-old/B.luau", ["/repo/out"])).toBe(false);
	});

	it("should match a path against a pattern in posix form", () => {
		expect(
			isIgnored("/repo/a.json.1.tmp", [/^\/repo\/a\.json\.[^/]+\.tmp$/])
		).toBe(true);
		expect(
			isIgnored("/repo/a.json", [/^\/repo\/a\.json\.[^/]+\.tmp$/])
		).toBe(false);
	});

	it("should not match anything when nothing is ignored", () => {
		expect(isIgnored("/repo/out", [])).toBe(false);
	});
});
