import { jest } from "@jest/globals";
import { MemoryWatcher } from "../memory-watcher.js";
import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";
import { FileType } from "../../fs/file-system-service.js";
import { NullLogService } from "../../log/log-service.js";
import { FileChangeType } from "../../fs/file-events.js";

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

	it("should emit ADDED and UPDATED events immediately without batching", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch([{ path: "src", recursive: true }]);

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
		await watcher.watch([{ path: "src", recursive: true }]);

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

	it("should respect non-recursive watch requests", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch([{ path: "package.json", recursive: false }]);
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

		await watcher.watch([
			{ path: "src", recursive: true },
			{ path: "tests", recursive: true },
		]);

		await memoryFs.writeFile("src/main.ts", "");
		await memoryFs.writeFile("tests/main.test.ts", "");
		await memoryFs.writeFile("ignored/other.ts", "");

		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("should gracefully stop emitting events after stop() is called", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch([{ path: "src", recursive: true }]);
		await watcher.stop();

		await memoryFs.writeFile("src/should-be-ignored.ts", "");

		expect(listener).not.toHaveBeenCalled();
	});
});
