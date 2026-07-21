import { jest } from "@jest/globals";
import { MemoryWatcher } from "../memory-watcher.js";
import { FileChangeType } from "../files.js";
import { ConsoleLogService } from "../../log/console-log-service.js";
import { LogLevel } from "../../log/log-service.js";
import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";
import { FileType } from "../../fs/file-system-service.js";

describe("MemoryWatcher", () => {
	let memoryFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let logService: ConsoleLogService;

	beforeEach(() => {
		jest.useFakeTimers();

		memoryFs = new MemoryFileSystemService();
		logService = new ConsoleLogService();
		logService.setLevel(LogLevel.Off);
		watcher = new MemoryWatcher(memoryFs, logService);
	});

	afterEach(async () => {
		await watcher.stop();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	it("should normalize ADDED and UPDATED events batched together into a single ADDED event", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch([{ path: "src", recursive: true }]);

		await memoryFs.writeFile("src/init.lua", "-- added");
		await memoryFs.writeFile("src/init.lua", "-- updated");

		jest.runAllTimers();

		expect(listener).toHaveBeenCalledWith([
			{
				type: FileChangeType.ADDED,
				path: "src/init.lua",
				fileType: FileType.File,
			},
		]);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should catch multiple DELETED events with accurate fileTypes when a directory is removed recursively", async () => {
		const listener = jest.fn();

		await memoryFs.writeFile("src/components/button.lua", "");
		await memoryFs.writeFile("src/components/card.lua", "");

		watcher.onDidChangeFile(listener);
		await watcher.watch([{ path: "src", recursive: true }]);

		await memoryFs.delete("src/components", true);

		jest.runAllTimers();

		expect(listener).toHaveBeenCalledWith(
			expect.arrayContaining([
				{
					type: FileChangeType.DELETED,
					path: "src/components",
					fileType: FileType.Directory,
				},
				{
					type: FileChangeType.DELETED,
					path: "src/components/button.lua",
					fileType: FileType.File,
				},
				{
					type: FileChangeType.DELETED,
					path: "src/components/card.lua",
					fileType: FileType.File,
				},
			])
		);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should respect non-recursive watch requests", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch([{ path: "package.json", recursive: false }]);
		await memoryFs.writeFile("package.json", "{}");

		jest.runAllTimers();
		expect(listener).toHaveBeenCalledTimes(1);

		listener.mockClear();

		await memoryFs.writeFile("package-lock.json", "{}");
		await memoryFs.writeFile("ignored-folder/fake-nested.txt", "...");

		jest.runAllTimers();

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

		jest.runAllTimers();

		expect(listener).toHaveBeenCalledWith(
			expect.arrayContaining([
				{
					type: FileChangeType.ADDED,
					path: "src/main.ts",
					fileType: FileType.File,
				},
				{
					type: FileChangeType.ADDED,
					path: "tests/main.test.ts",
					fileType: FileType.File,
				},
			])
		);
		const calls = listener.mock.calls[0][0] as unknown[];
		expect(calls).toHaveLength(2);
	});

	it("should gracefully stop emitting events after stop() is called", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch([{ path: "src", recursive: true }]);

		await watcher.stop();

		await memoryFs.writeFile("src/should-be-ignored.ts", "");

		jest.runAllTimers();

		expect(listener).not.toHaveBeenCalled();
	});

	it("should cancel out rapid ADD -> UPDATE -> DELETE for the same file and emit nothing", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch([{ path: "cache", recursive: true }]);

		await memoryFs.writeFile("cache/temp.txt", "init");
		await memoryFs.writeFile("cache/temp.txt", "update 1");
		await memoryFs.writeFile("cache/temp.txt", "update 2");
		await memoryFs.delete("cache/temp.txt");

		jest.runAllTimers();

		expect(listener).not.toHaveBeenCalled();
	});
});
