import { jest } from "@jest/globals";
import { VersionCommand } from "../version.js";
import { LogService } from "../../../platform/log/log-service.js";

describe("VersionCommand", () => {
	it("should output the version text via log service", () => {
		const mockLogService = {
			info: jest.fn(),
		} as unknown as LogService;

		const command = new VersionCommand(mockLogService);
		const result = command.execute();

		expect(result.isOk()).toBe(true);
		expect(mockLogService.info).toHaveBeenCalledTimes(1);
		expect(mockLogService.info).toHaveBeenCalledWith(
			expect.stringContaining("rogen")
		);
	});
});
