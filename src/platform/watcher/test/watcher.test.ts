import { jest } from "@jest/globals";
import { MemoryWatcher } from "../memory-watcher.js";
import { FileChangeType } from "../files.js";
import { ConsoleLogService } from "../../log/console-log-service.js";
import { LogLevel } from "../../log/log-service.js";
import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";

describe("MemoryWatcher", () => {
	let memoryFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let logger: ConsoleLogService;

	beforeEach(() => {
		memoryFs = new MemoryFileSystemService();
		logger = new ConsoleLogService();
		logger.setLevel(LogLevel.Off);
		watcher = new MemoryWatcher(memoryFs, logger);
	});

	afterEach(async () => {
		await watcher.stop();
	});

	it("should catch ADDED and UPDATED events when files are written", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch([{ path: "src", recursive: true }]);

		await memoryFs.writeFile("src/init.lua", "-- added");

		expect(listener).toHaveBeenCalledWith([
			{ type: FileChangeType.ADDED, path: "src/init.lua" },
		]);

		await memoryFs.writeFile("src/init.lua", "-- updated");

		expect(listener).toHaveBeenCalledWith([
			{ type: FileChangeType.UPDATED, path: "src/init.lua" },
		]);
	});

	it("should catch DELETED events when single files are removed", async () => {
		const listener = jest.fn();
		await memoryFs.writeFile("src/temp.lua", "-- temp");

		watcher.onDidChangeFile(listener);
		await watcher.watch([{ path: "src", recursive: true }]);

		await memoryFs.delete("src/temp.lua");

		expect(listener).toHaveBeenCalledWith([
			{ type: FileChangeType.DELETED, path: "src/temp.lua" },
		]);
	});

	it("should catch multiple DELETED events when a directory is removed recursively", async () => {
		const listener = jest.fn();

		await memoryFs.writeFile("src/components/button.lua", "");
		await memoryFs.writeFile("src/components/card.lua", "");

		watcher.onDidChangeFile(listener);
		await watcher.watch([{ path: "src", recursive: true }]);

		await memoryFs.delete("src/components", true);

		expect(listener).toHaveBeenCalledWith([
			{ type: FileChangeType.DELETED, path: "src/components" },
		]);
		expect(listener).toHaveBeenCalledWith([
			{ type: FileChangeType.DELETED, path: "src/components/button.lua" },
		]);
		expect(listener).toHaveBeenCalledWith([
			{ type: FileChangeType.DELETED, path: "src/components/card.lua" },
		]);
	});

	it("should ignore file mutations outside of the active watch requests", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch([{ path: "src", recursive: true }]);

		await memoryFs.writeFile("ignored/test.lua", "-- outside scope");

		expect(listener).not.toHaveBeenCalled();
	});

	it("should respect non-recursive watch requests", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch([{ path: "package.json", recursive: false }]);

		await memoryFs.writeFile("package.json", "{}");
		expect(listener).toHaveBeenCalledTimes(1);

		await memoryFs.writeFile("package-lock.json", "{}");

		await memoryFs.writeFile("package.json/fake-nested.txt", "...");

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should stop receiving events after stop() is called", async () => {
		const listener = jest.fn();
		watcher.onDidChangeFile(listener);

		await watcher.watch([{ path: "src", recursive: true }]);
		await watcher.stop();

		await memoryFs.writeFile("src/file.lua", "data");

		expect(listener).not.toHaveBeenCalled();
	});
});
