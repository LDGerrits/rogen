import path from "path";
import { jest } from "@jest/globals";
import { VersionCommand } from "../version-command.js";
import { LogService } from "../../../platform/log/log-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";

describe("VersionCommand", () => {
	const versionCommandDir = path.dirname(import.meta.dirname);

	it("should output the version read from the nearest package.json", async () => {
		const fileSystemService = new MemoryFileSystemService();
		await fileSystemService.writeFile(
			path.join(versionCommandDir, "package.json"),
			JSON.stringify({ version: "9.9.9" })
		);

		const mockLogService = {
			info: jest.fn(),
		} as unknown as LogService;

		const command = new VersionCommand(mockLogService, fileSystemService);
		const result = await command.execute();

		expect(result.isOk()).toBe(true);
		expect(mockLogService.info).toHaveBeenCalledWith("rogen 9.9.9");
	});

	it("should fall back to 'unknown' when no package.json is found", async () => {
		const fileSystemService = new MemoryFileSystemService();

		const mockLogService = {
			info: jest.fn(),
		} as unknown as LogService;

		const command = new VersionCommand(mockLogService, fileSystemService);
		const result = await command.execute();

		expect(result.isOk()).toBe(true);
		expect(mockLogService.info).toHaveBeenCalledWith("rogen unknown");
	});
});
