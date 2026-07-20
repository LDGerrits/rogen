import { jest } from "@jest/globals";
import { LogService } from "../../../platform/log/log-service.js";
import { HelpCommand } from "../help.js";

describe("HelpCommand", () => {
	it("should output the help instructions via the log service", () => {
		const mockLogService = {
			info: jest.fn(),
		} as unknown as LogService;

		const command = new HelpCommand(mockLogService);
		const result = command.execute();

		expect(result.isOk()).toBe(true);
		expect(mockLogService.info).toHaveBeenCalledTimes(1);
		expect(mockLogService.info).toHaveBeenCalledWith(
			expect.stringContaining(
				"Rogen - A tool for feature-based folder structures"
			)
		);
	});
});
