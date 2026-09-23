import path from "path";
import { jest } from "@jest/globals";
import "../version-command.js";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import {
	LogService,
	NullLogService,
} from "../../../platform/log/log-service.js";

describe("version command", () => {
	const versionCommandDir = path.dirname(import.meta.dirname);
	let store: DisposableStore;
	let fileSystemService: MemoryFileSystemService;
	let logService: NullLogService;
	let commandService: CoreCommandService;

	beforeEach(() => {
		store = new DisposableStore();
		fileSystemService = new MemoryFileSystemService();
		logService = new NullLogService();
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(FileSystemService, fileSystemService);
		commandService = store.add(
			new CoreCommandService(services, logService)
		);
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should output the version read from the nearest package.json", async () => {
		await fileSystemService.writeFile(
			path.join(versionCommandDir, "package.json"),
			JSON.stringify({ version: "9.9.9" })
		);
		const info = jest.spyOn(logService, "info");

		const result = await commandService.executeCommand("version", {
			_: ["version"],
		});

		expect(result.isOk()).toBe(true);
		expect(info).toHaveBeenCalledWith("rogen 9.9.9");
	});

	it("should fall back to 'unknown' when no package.json is found", async () => {
		const info = jest.spyOn(logService, "info");

		const result = await commandService.executeCommand("version", {
			_: ["version"],
		});

		expect(result.isOk()).toBe(true);
		expect(info).toHaveBeenCalledWith("rogen unknown");
	});
});
